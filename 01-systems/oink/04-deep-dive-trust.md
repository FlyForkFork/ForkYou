# 04 深挖：信任边界——自动解锁、剪贴板回环与文件授权

## 这篇回答什么问题

一个软件 KVM 本质上是"装在每台电脑上的远程输入设备"，它拿到的是最高权限：能注入按键、能读剪贴板、能读文件、能替你输密码。Oink 在 0.3.4/0.3.5 加的三件事——自动解锁、剪贴板去重、Paste as File——恰好各自压在一个信任边界上。这篇拆它怎么把"能力"关进"边界"。

## 问题是什么

跨设备协作软件的信任边界不是一条，是四条，而且方向不同：

1. **本机凭据**：自动解锁要把登录密码存在本地。存哪、谁能读、怎么保证它不进日志/不进入 IPC 错误/不进入组配置？
2. **跨设备请求**：A 机说"我这边用户刚解锁了，你也解锁吧"。B 机凭什么信？这条消息可以被重放、可以被伪造、可以来自一个已经失陷的同伴。
3. **数据回环**：剪贴板同步器（包括 Oink 自己）会把内容写回剪贴板，形成"我同步给你、你又同步回我"的回声。去重逻辑如果误判，会丢用户的剪贴板内容；如果过于保守，会无限循环。
4. **文件与诊断**：拖拽/粘贴文件时，接收方拿到的是"某个设备给的某个文件"的授权，这个授权不能因为重启、换设置、换同伴而扩大。诊断包会把日志带出机器，里面绝不能有按键原值。

## 朴素做法为什么不够

| 朴素做法 | 失效点 |
|---|---|
| 密码存配置文件，`Debug` 派生默认 | 任何一次 `{:?}` 或序列化错误就把明文写进日志/崩溃报告 |
| "同伴说解锁了"就解锁 | 一条重放的消息可以解锁任何锁定的机器 |
| 用内容哈希判断剪贴板回声 | v1 offer 不带 digest，读内容要从源设备拉取；而且哈希碰撞/误判会直接吞掉用户内容 |
| 文件授权按路径给 | 路径可被替换；重启后授权应失效的地方没失效 |
| 诊断包原样打包日志 | 按键、密码、剪贴板文本全在里面 |
| 更新源用环境变量覆盖 | 本机任何一个进程都能把更新指向自己的服务器 |

## 核心机制

### 1. 凭据：一个"只能被本地 API 序列化"的类型

`crates/oink-agent/src/auto_unlock/mod.rs:1` 的模块文档只有一句：

> Local credentials never participate in owner options, group config or wire DTOs.

实现上是一个新类型 `Password(String)`（`:20`），它做了四件事：

- `Debug` 手写成 `[redacted]`（`:26-29`），注释说明原因：「Requests are also carried by diagnostic/error wrappers」——请求对象会被诊断/错误包装器带着走，所以 Debug 必须安全。
- `Drop` 调 `self.0.zeroize()`（`:31-34`），内存释放前擦除。
- 自定义 `Deserialize`（`:37-46`）：反序列化失败时只返回固定的 `"invalid password value"`，**绝不让 serde 把被拒绝的原值回显进 IPC 错误或崩溃报告**。
- 只有 `expose()`（`pub(crate)`）能取到明文，且只在真正要交给系统登录 API 的那一刻调用。

这是"类型即边界"的典型用法：不是靠代码评审记得别打印密码，而是让打印密码这件事在类型上不可能发生。

存储侧：macOS 走 Keychain（Security framework FFI，`auto_unlock/macos.rs`）；Windows 走 DPAPI，且加密数据的安全描述符是 `"O:SYG:SYD:P(A;OICI;FA;;;SY)"`（`crates/oink-winsvc/native/unlock.cpp`）——只有 SYSTEM 能读，连 Administrators 都不行。

### 2. 同步解锁：提示不是命令，目标必须反向质询

`crates/oink-agent/src/auto_unlock/sync.rs:1` 的文档是整个协议的一句话规格：

> The initiator sends one hint per user unlock edge; the target never trusts it and challenges the source on the same logical session (direct or relayed) before running one local transaction.

拆开看是四层：

**第一层：什么叫"一次解锁边"。** `UnlockEdge::observe(Option<bool>)`（`:72`）只在"确认锁定 → 确认解锁"这个转变上产生边。`None`（状态未知）既不形成边也不打断边；启动后第一个确定读数只作为基线，不产生边。这避免了"刚启动就看到解锁状态"被误判成用户刚解锁。

**第二层：提示只带 epoch。** 发起方发 `ControlSyncUnlock{epoch}`，接收方**不执行**，而是用同一逻辑会话回一个 `ControlUnlockQuery{epoch}` 问源设备"你现在到底锁没锁"。

**第三层：重放栅栏。** `SyncGate`（`:144`）维护 `seen: HashMap<DeviceId, (Boot, u64)>`。`admit()`（`:160`）要求：同一个 boot 下，epoch 必须比上次见过的大。设备重启后 boot 变了，可以重新开始。这挡住了"把上次的解锁消息再发一遍"。

**第四层：两段式确认。** `confirm()`（`:183`）只有在回复是 `unlocked` **且**距 `pending.at` 不超过 `SOURCE_REPLY`（2s，`:17`）时才消费；否则返回 `false`，把这次 reply 留给 `EntryGate`（指针进入触发的解锁）去处理。两个不同来源的解锁共用同一个 reply 通道，但用**独立的 epoch 区间**区分——同步解锁的 query epoch 在一个高区间，指针进入的 `UnlockReply` 无法满足同步解锁。

时间预算也是分层的：`SOURCE_REPLY 2s`（等源设备回答）、`OWN_UNLOCK 5s`（本机刚被用户解锁的窗口，`recent():96`）、`LOCAL_TYPING 2s`（macOS 本机打字时跳过同步解锁，`:22`）。Windows 侧对应 `AUTO_UNLOCK_SYNC_WINDOW 3s`（`crates/oink-winsvc/src/auto_unlock.rs:34`）。

Windows 的服务状态机在 `crates/oink-winsvc/native/unlock-policy.hpp`：`RemoteInputWindowMs 2000`（`:8`）、`PendingTtlMs 30000` 与 `SyncPendingTtlMs 3000`（`:12`）。`ready()`（`:65`）的判定是：

```
eligible = sync || (input_source == source && input_at <= now && now - input_at <= 2000)
```

也就是说"非同步"的解锁必须由**刚刚发生在这台机器上的真实输入**触发，且输入年龄不超过 2 秒。这条把"指针刚移进来"变成了可验证的物理事实，而不是一个可伪造的布尔值。

状态机的几个刻意约束写在头文件注释里：枚举只读、`consume` 先于解密、未知结果保持阻塞直到新的本地保存、操作不跨服务重启、发密钥前先落 durable failure latch。最后一条尤其重要：**先把"我要发密钥了"写进磁盘，再发**——如果发到一半崩溃，重启后能看到"有一个未完成的操作"，而不是以为什么都没发生。

### 3. 打字：2 秒上限 + 锁定状态复查

`crates/oink-agent/src/auto_unlock/typing.rs` 的 `MAX_TYPING` 是 2 秒，注释说明它**低于既有的 5 秒输入积压安全阀**——自动输入必须在手动输入的容错窗口内完成，否则就会和用户的真实按键混在一起。`before_character(now, eligible, locked)` 每个字符前都要重新检查：`locked == Some(true)`、未超 deadline、eligible。任何一条不满足就停止并释放暂存按键。错误文案是给用户看的：「本机已解锁或锁定状态未知，自动输入已停止」。

这是"每个字符都是一次重新授权"的设计，而不是"开始打字时授权一次，之后一路打到底"。

### 4. 剪贴板：marker 是身份，不是内容

`crates/oink-clipboard/src/dedupe.rs:1-26` 的文档说得很清楚：

- Oink 从收到的 offer 写入剪贴板时，会给这个 clip 打一个私有 marker（`MARKER_MAC` / `MARKER_WINDOWS`），marker 的字节**只表示这个 clip 的身份**。
- 如果另一个同步器把整个剪贴板原样拷回来，marker 也跟着回来，于是凭 marker 就能识别"这是我的回声"，**只读 marker，不读内容**。
- marker 是内部格式：从每个通告的 inventory 里移除，永不参与格式比较。
- 内容比较是**发送侧**的 fallback，受「Clipboard deduplication」设置控制；接收方收到 offer 一律写入，不做抑制。

这条"只在发送侧抑制"的规则是防丢内容的关键：接收侧如果也做抑制，一旦误判就会把用户真正想粘贴的内容丢掉；发送侧误判最多是"这次没发出去"，用户还能手动复制。

比较规则（`crates/oink-foundation/src/clipboard_dedupe.rs`）按类做 subset 容忍：文本按换行归一后摘要相等、图像按解码像素摘要+尺寸、文件按名字+类型（双方已知时再比 size/mtime）、HTML/RTF/URL 需要旧内容同类且不能单独锚定回声。上限 `TEXT_DIGEST_BYTES 16MiB`（`:46`）、`IMAGE_DIGEST_BYTES 128MiB`（`:49`）、`MODIFIED_TOLERANCE_MS 2000`（`:53`）。

一个特别克制的决定：**Universal Clipboard 的 promise 内容从不读取**。`com.apple.is-remote-clipboard`（`:35`）是"我保证内容在另一台 Apple 设备上，你要就去拿"的承诺，读它等于触发一次跨设备拉取。Oink 把它按 unknown 处理——不读、不比、不猜。

### 5. 文件授权：设备绑定的 LinkToken

`crates/oink-clipboard/src/content/grants.rs` 的文档：

> Device-bound, durable authority for offered files… journal contains metadata only, never received file bytes.

- `LinkToken(pub [u8; 32])`（`:43`），`Debug` 输出 `[redacted]`（`:52`）。
- `SourceGrants`（`:276`）是持久授权表，`load(directory, members)`（`:320`）时按当前成员 `reconcile_members`（`:404`）——成员变了，旧授权自动失效。
- `issue(peer, source, roots) -> LinkToken`（`:515`）签发时绑定"哪个 peer、哪个 source、哪些 roots"。
- `open(peer, token)`（`:963`）打开时校验 peer 和 token 的绑定关系。

同一文件里还有三个开关：`set_peer_file_filter`（`:451`）、`set_peer_safe_symlinks`（`:455`）、`set_peer_exec_bits`（`:462`）——分别控制"哪些文件能收"、"符号链接是否安全"、"可执行位是否保留"。这些是**每个 peer 独立**的策略，不是全局开关。

### 6. 观测面：隐私边界写在模块第一行

`crates/oink-agent/src/diagnostics/privacy.rs:1`：

> The privacy boundary. No raw key or free-form text is an event payload.

诊断记录只存结构化事件，按键只存"哪个键的类别/统计"，不存原值。匿名化用 blake3 的 `derive_key`（分组/独立两种命名空间）。整个诊断包有硬上限：`MAX_BYTES 64MiB`（`diagnostics/mod.rs:116`）、`MAX_SEGMENT_RAW 512KiB`（`:117`）、自动范围 30 分钟（`:115`），导出默认也是最近 30 分钟（`api.rs:2109-2110`）。

### 7. 本地 IPC 与更新源

`crates/oink-agent/src/ipc.rs:1-13`：Windows 只用**用户 SID 限定**的命名管道，Unix 用数据目录下的私有 socket；`ipc.json` 发布地址、锁 owner 和**一次性 secret**。所有请求一行一个 JSON，带 token。

`crates/oink-update/src/trust.rs:1`：

> Reviewed release roots are compiled into binaries. No environment/IPC override.

更新根的配置是 `include_bytes!("../../../packaging/update-trust.json")` 编译进二进制的。没有环境变量覆盖，没有 IPC 覆盖。加上 `feed.rs:44` 的 `https://updates.oink.hachiwii.com` 和 `https_url()` 的 scheme 校验（`:361-371`），整条更新链的信任起点是"你安装的那个二进制"。

## 代码证据

| 事实 | 位置 |
|---|---|
| 凭据不进 owner 配置/组配置/线缆 DTO | `crates/oink-agent/src/auto_unlock/mod.rs:1` |
| Password 的 Debug 脱敏 + Drop zeroize + 反序列化不回显 | `crates/oink-agent/src/auto_unlock/mod.rs:20-46` |
| 同步解锁：提示→反向质询→同会话→单次本地事务 | `crates/oink-agent/src/auto_unlock/sync.rs:1` |
| 重放栅栏 `seen: HashMap<DeviceId,(Boot,u64)>` | `crates/oink-agent/src/auto_unlock/sync.rs:144-160` |
| 两段式确认，2s 回复窗口 | `crates/oink-agent/src/auto_unlock/sync.rs:17,183` |
| 打字 2s 上限与每字符复查 | `crates/oink-agent/src/auto_unlock/typing.rs` |
| Windows 解锁资格 = 同步 或 2s 内真实输入 | `crates/oink-winsvc/native/unlock-policy.hpp:65-78` |
| 剪贴板 marker 是身份、内容比较仅在发送侧 | `crates/oink-clipboard/src/dedupe.rs:1-26` |
| 文件授权设备绑定、journal 只存元数据 | `crates/oink-clipboard/src/content/grants.rs:1-43` |
| 诊断无原始按键/自由文本 | `crates/oink-agent/src/diagnostics/privacy.rs:1` |
| 更新根编译进二进制、不可覆盖 | `crates/oink-update/src/trust.rs:1` |
| IPC 用户 SID 管道 + 一次性 secret | `crates/oink-agent/src/ipc.rs:1-13` |

## 复杂度与边界

- **自动解锁是平台特化的**：macOS 1085 行、Windows 819 行 C++，两边几乎不共享逻辑（只有 policy 的接口形状相似）。这是必要的——锁屏 API、凭据存储、就绪判定全不一样。
- **"就绪"判定有竞态**：loginwindow 表面稳定靠 600ms 稳定窗口 + 20ms 采样 + 100ms 最大间隔来判定，但这仍然是启发式。代码里 `READINESS_TIMEOUT 5s` 说明会放弃，不会无限等。
- **Secure Input 故意不作就绪条件**（`macos.rs`）——这是一个反直觉的决定：macOS 的 Secure Input 本意是防键盘记录，如果等它关闭才能输密码，很多场景永远等不到。Oink 选择"不看它"，改用锁屏状态 + 表面稳定。
- **marker 方案依赖对端不剥离私有格式**：如果另一个同步器把 marker 删了，就退化为内容比较；如果内容也不可比（比如 promise），就按 unknown 处理——**unknown 永远不当作重复**，宁可多发一次。
- **2 秒的自动打字窗口**是可用性下限：密码特别长时可能打不完（推断：按普通打字速度与 2 秒窗口估算）。这是刻意的取舍——超时停止比"打到一半卡住"好。

## 取舍与局限

**取舍 1：不做"信任同伴"的捷径。** 每次同步解锁都要一次反向质询往返。代价是多一个 RTT；收益是即使同伴完全失陷，也只能"请求"，不能"命令"。

**取舍 2：密码只存本地，且只在解锁那一刻解密。** 没有"记住密码自动填充"的便利，但也没有"内存里长期驻留明文"的风险。`consume 先于解密`这条注释说明连"读出来再判断"都不行，必须判断完才解密。

**取舍 3：剪贴板去重只在发送侧。** 代价是可能多发一次（带宽），收益是绝不吞用户内容。

**取舍 4：更新根不可配置。** 企业部署想换内部镜像就得重新编译。这是安全换灵活性的明确选择。

**局限 / 待查实**：
- macOS Keychain 的具体访问控制属性（是否需要用户授权每次读取）本次没有逐行核对 `macos.rs` 的 SecItem 参数，标"待查实"。
- Windows DPAPI 的 `CryptProtectData` 是否带 `CRYPTPROTECT_LOCAL_MACHINE` 标志未核对，影响"是否只有同一用户能解"的判断，标"待查实"。
- 自动解锁的失败计数/锁定策略（防暴力猜密码）在代码里没有明显的计数器，可能依赖系统登录本身的失败锁定。标"待查实"。

## 我能偷什么

1. **给敏感值一个专用类型**：手写 `Debug` 打码、`Drop` 清零、反序列化错误不回显。三行代码换掉一整类"日志泄漏"事故。
2. **"提示"与"命令"分离**：跨设备/跨进程的敏感操作，收到请求的一方必须能独立验证，而不是转发执行。
3. **（boot, epoch）重放栅栏**：任何"一次性事件"的跨设备传递都应该带一个单调 epoch，并按 boot 分组。比时间戳可靠。
4. **每字符重新授权**：长事务（打字、批量操作）应该在每个单元前复查前置条件，而不是开头检查一次。
5. **marker 优先于指纹**：能给数据打"自己的身份标记"时，别用内容哈希——身份是精确的，哈希是概率的。
6. **只在"产生副作用"的一侧做抑制**：去重、限流、缓存这类逻辑，抑制放在发送侧/主动侧，接收侧永远接受。
7. **信任根编译进二进制**：更新源、CA、公钥这类东西，不要做成运行时可改的配置。

## 一句话记住

Oink 的信任模型一句话：**能力可以跨设备，授权不能跨设备**——密码只在本机解密、解锁请求必须反向质询、文件授权绑定设备、更新根焊死在二进制里；所有"看起来像信任"的地方，实际都是一次可验证的质询。
