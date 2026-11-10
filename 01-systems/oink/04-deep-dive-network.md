# 04 深挖：网络与配对——单线程 QUIC owner 与 500µs 预算

## 这篇回答什么问题

一个 P2P 软件 KVM 的网络层要怎么设计，才能同时做到"延迟可预测、断线能自愈、配对不被中间人、不自己写可靠传输"？Oink 的答案是：把所有 QUIC 状态收进一个私有单线程 runtime，用三段预算跑每一轮，可靠性全交给 QUIC，配对用 SPAKE2 + 6 位码。

## 问题是什么

跨设备输入的网络需求和普通 RPC 完全不同：

1. **延迟是第一指标，吞吐不是**。指针移动的端到端延迟超过 ~20ms 就能被感知为"拖影"。
2. **必须自带加密**，因为局域网里可能有陌生设备。
3. **必须能在 NAT/防火墙/多网卡下连通**，且"直连失败要能退到中继，中继通了还要尝试切回直连"。
4. **必须有配对机制**，因为"局域网内自动发现"不等于"信任"。
5. **不能自己写可靠传输**——重传、拥塞、流控每一样都是深坑。

## 朴素做法为什么不够

| 朴素做法 | 失效点 |
|---|---|
| 每条链路一个线程 + `Mutex<Connection>` | 多链路时锁竞争直接体现为输入抖动；线程数随设备数增长 |
| 用 TCP 长连接 + 自定义帧 | 需要自己处理队头阻塞；游戏模式的相对运动必须可靠传输，浪费重传 |
| 用 UDP + 自研 ARQ | 重传策略、拥塞窗口、流控窗口全部要自己调；这是最容易出隐蔽 bug 的地方 |
| 发现即信任 | 局域网里任何人广播一个 advert 就能成为"设备" |
| 只做直连 | 跨网段/防火墙场景直接不可用 |
| 只做中继 | 所有流量绕一圈，延迟翻倍 |

## 核心机制

### 1. 三态链路 + 并发拨号 + 一跳 relay + cut-over

`crates/oink-network/src/link/mod.rs:1-21` 的模块文档是整个设计的摘要（原文要点）：

- 三态链路、paths、连接池、端到端心跳、并发拨号选择、一跳 relay、relay→direct cut-over。
- 私有 N0/N1 流；**不做发现、地址簿、成员管理**（那是上层的事）。
- 所有状态在 `oink-network` 线程私有的单线程 runtime 里。
- `LinkLayer` 是可克隆句柄，只发小的定长命令。
- 可靠性/重传/流控/拥塞交给 QUIC 与内核 TCP，**无 seq/ack/replay/credit**。

时间尺度全部是常量（`link/mod.rs:53-90`）：

| 常量 | 值 | 含义 |
|---|---|---|
| `HEARTBEAT_INTERVAL` | 500ms | 端到端心跳间隔 |
| `HEARTBEAT_TIMEOUT` | 2s | 心跳超时（4 个周期） |
| `IDLE_TIMEOUT` | 10s | 空闲超时 |
| `KEEP_ALIVE` | 5s | QUIC keep-alive |
| `MAX_DIALS` | 8 | 并发拨号上限 |
| `DIAL_BUDGET` | 3s | 单次拨号预算 |
| `ADDRESS_QUERY_BUDGET` | 5s | 地址查询预算 |
| `MAX_INBOUND_PENDING` | 32 | 待处理入站连接上限 |
| `RELAY_TIMEOUT` | 3s | 中继建立超时 |
| `CUTOVER_TIMEOUT` | 500ms | relay→direct 切换超时 |
| `DIRECT_RETRY` | [15,15,30,60]s | 中继态下重试直连的退避序列 |
| `ROUND_BUDGET` | 500µs | 单轮总预算 |
| `OWN_BUDGET` | 100µs | 第一段：自己的活 |
| `INTERACTIVE_BUDGET` | 250µs | 第二段：交互流 + datagram |
| `NORMAL_BUDGET` | 150µs | 第三段：普通流/命令/新连接 |

`DIRECT_RETRY` 的注释（`link/mod.rs:74`）写「Direct attempts of a relayed link: first after 15 s, then this long after each」——中继态不是终点，它会持续尝试升级回直连，但不会疯狂重试。

### 2. 一轮 500µs 的实际代码

`crates/oink-network/src/link/runtime.rs:270-310` 的循环体是这套预算的实现：

1. **两次 `yield_now`** — 让出执行权，避免饿死同 runtime 的其他任务。
2. **macOS rebind socket** — 放在 Quinn socket 回调**外**做，避免在回调里改 socket 导致重入。
3. **`began = Instant::now()`** — 记本轮起点。
4. **迟到轮统计** — `late_rounds` / `late_max`，用于观测"这一轮是不是来晚了"。
5. **`tick` / `probe_tick` / `retry_n1` / `effects`** — 自己的活（心跳、探测、N1 重试、副作用）。
6. **三段 deadline** — `budgets = [began + OWN, began + OWN + INTERACTIVE, began + ROUND]`。
7. **`service(0/1/2)`** — 按优先级依次服务三类工作，每段到点就停。
8. **`check_drained`** — 检查队列是否排空。
9. **`over_budget` 计数** — 本轮超预算就记一笔。
10. **`realtime::read_back()` 与 `schedule.applied` 比对** — 不符则 `demoted += 1`。

第 10 步是整个设计里最容易被忽略但最有价值的一点：**它不相信"我设置了实时调度"这件事**。设置完立刻读回，之后周期性复查，不一致就计数。很多项目设了 QoS/MMCSS 就假设生效，实际被系统降级后没有任何信号。

### 3. 数据报：固定拷贝 + CAS 抢占，失败即"没活干"

游戏模式的相对运动走 datagram，它的接收路径在 `crates/oink-network/src/link/realtime_datagram.rs`：

- 固定大小的拷贝，不分配。
- 分区的 M1 接收 lane。
- `UnsafeCell` slot + 原子游标。
- **claim 用 CAS `AtomicBool`，失败就是"没活干"，不重试、不自旋、不等待**。
- `unsafe impl Sync for Lane`。

这个"失败即放弃"的语义是实时系统的正确选择：如果这一帧的数据报没抢到 lane，正确的行为是丢掉它继续，而不是等——因为等出来的数据已经过期了。

`probe_socket.rs:1-3` 有一个相关细节：手动地址查询用**独占的 connected UDP socket**，理由是"只有 connected socket 才能把 ICMP 错误归属到那一次查询"。用共享 socket 做探测，收到的 ICMP 无法确定属于哪个目标。

### 4. QoS：固定拥塞窗口 + macOS 网络服务类型

`crates/oink-network/src/qos.rs`：

- 固定拥塞窗口（`FixedWindowConfig`）——不用 BBR/CUBIC 的自适应，因为在局域网低延迟场景下自适应反而引入波动。
- `DATAGRAM_SEND_BUFFER` 8KiB。
- `SEND_WINDOW` 2MiB（quinn 默认 10MiB）——收窄窗口是为了限制排队延迟。
- `ServiceType::Voice` 在 macOS 上用 `setsockopt(SOL_SOCKET, 0x1116, 4)` 设置网络服务类型。

### 5. 配对：SPAKE2 + 6 位码 + transcript 绑定

`crates/oink-network/src/group_pake.rs`（测试在 `:246,260,273`）：

- **6 位纯数字码**：`valid_code` 要求 `len == 6` 且全是 ASCII 数字（`:28`）；`generate_code` 返回 `Zeroizing` 的 `06d` 格式（`:31`）——`06d` 保证前导零不丢（测试 `syntax_is_exact_and_generators_preserve_leading_zeroes:273` 专门验这个）。
- **密钥材料带 `ZeroizeOnDrop`**：`Keys{receiver, initiator, transcript}`（`:38`）。
- **transcript 绑定四样东西**：`Transcript::new(context, attempt, hello, info)`（`:53`）。绑定"UI 角色"（谁显示码、谁输入码）、"精确 greeting 帧"、"完整带标签身份"、"每次 attempt"。
- **派生与确认**：`derive:76`、`mac:94`、`identities:100`、`start:113`、`finish:136`、`respond:154`。
- 测试 `confirmations_bind_roles_code_and_attempt:246` 与 `wrong_code_or_transcript_does_not_confirm:260` 是这套设计的验收：换角色不确认、换码不确认、换 attempt 不确认。

为什么绑定"角色"很重要：如果不绑，攻击者可以让双方都以为自己是在"输入码"的一方，从而做角色反射攻击。绑定 attempt 则是防重放——上次配对的 transcript 不能用于这次。

### 6. TLS 身份：证书里的 Ed25519 公钥就是设备 ID

`crates/oink-network/src/tls.rs:1-6`：

> 双方都用设备 Ed25519 密钥签发的自签名证书完成 TLS 1.3 握手。验证方式不依赖任何 CA：从证书中取出 Ed25519 公钥作为对方的设备 ID，并用这个公钥验证握手签名（`CertificateVerify`），所以握手结束即确知对方身份。

实现上 `device_id_from_cert` 会**先解析证书结构再取 SPKI**（`tls.rs:24` 注释：「A matching byte sequence in a subject name or extension is never an identity」）——防止有人把公钥字节塞进 subject name 里冒充。SPKI 的算法 OID 必须是 `1.3.101.112`（Ed25519）且 `parameters` 必须为空。

`PeerVerifier` 同时实现 `ServerCertVerifier`（`:163`）和 `ClientCertVerifier`（`:201`）——双向认证，双方都验对方。

### 7. 成员关系：签名不可变记录

`crates/oink-network/src/roster.rs:1-2`：

> Signed immutable membership records. Trust is pinned by the caller; received self-signed roots never establish authority for an existing group.

上限 `MAX_MEMBERS = 16`、`MAX_RECORDS = 256`。`Anchor{group, root}` 是信任锚，由调用方钉住。这句话防的是一种经典攻击：攻击者生成一个自签名的 root，声称"我是这个组的新 root"，如果接收方接受，整组就被接管了。

### 8. 流类型与优先级

`crates/oink-protocol/src/frame.rs` 定义流类型：

| 值 | 名称 | 用途 |
|---|---|---|
| 0 | Internal (N0) | 内部 |
| 1 | LowControl (N1) | 低优先控制 |
| 2 | Config (C0) | 配置/组状态 |
| 3 | Input (I0+I1) | 输入（I0 datagram、I1 reliable） |
| 4 | Clipboard (B0) | 剪贴板 |
| 5 | Audio (M0+M1) | 音频（M0 控制、M1 媒体） |
| 6 | — | 保留 |
| 8 | Diagnostics (D0+D1) | 诊断 |
| 9 | Wallpaper | 壁纸 |
| 10 | Dnd | 拖拽 |
| 11 | Cache | 缓存 |
| 12 | Projection (P0) | 投影 |
| 13/14/15 | LayoutProfiles / V2 / V3 | 布局配置（版本化） |

`priority()` 只分两档：`Internal | Input → Interactive`，其余 `Normal`。**双向流上限为 0**（`frame.rs:18`）——所有流都是单向的，方向由"谁开"决定。这条约束消除了"双向流两端同时写"的一整类竞态。

帧上限（`crates/oink-protocol/src/v1/limits.rs`）：可靠帧 16KiB、配置帧 128KiB、Low 帧 16MiB、datagram 1100、发现包 1200、单向流上限 256。

## 代码证据

| 事实 | 位置 |
|---|---|
| 三态链路/并发拨号/relay/cut-over，无自研可靠传输 | `crates/oink-network/src/link/mod.rs:1-21` |
| 心跳 500ms / 超时 2s / 空闲 10s | `crates/oink-network/src/link/mod.rs:53-58` |
| 直连重试退避 [15,15,30,60]s | `crates/oink-network/src/link/mod.rs:74-76` |
| 500µs 分三段预算 | `crates/oink-network/src/link/mod.rs:87-90` |
| 一轮循环的实际顺序 + 调度降级比对 | `crates/oink-network/src/link/runtime.rs:270-310` |
| datagram 接收 CAS 抢占，失败即放弃 | `crates/oink-network/src/link/realtime_datagram.rs` |
| 探测用独占 connected socket | `crates/oink-network/src/link/probe_socket.rs:1-3` |
| 固定拥塞窗口 / 2MiB send window / macOS 服务类型 | `crates/oink-network/src/qos.rs` |
| SPAKE2 6 位码 + transcript 绑定角色/attempt | `crates/oink-network/src/group_pake.rs:28-53` |
| 证书 SPKI 即设备 ID，先解析结构 | `crates/oink-network/src/tls.rs:1-6,24` |
| 签名不可变成员记录，不信任自签名 root | `crates/oink-network/src/roster.rs:1-2` |
| 流类型表 + 两档优先级 + 零双向流 | `crates/oink-protocol/src/frame.rs` |

## 复杂度与边界条件

- **单线程的天花板**：所有链路共享 500µs/轮。设备数 × 流数增长时，每轮能服务的量下降。Oink 的上限是 `MAX_MEMBERS = 16`，实际使用大概 2–5 台，余量足够。
- **预算不可硬保证**：500µs 是"目标"，不是"承诺"。代码里 `over_budget` / `late_rounds` / `late_max` 就是在承认这一点并度量它。
- **datagram 会丢**：1100 字节上限低于典型 MTU 1200，避免分片；但丢包是常态，游戏模式必须容忍。
- **relay 的质量不可控**：一跳 relay 由组内某台设备转发，那台设备的网络状况直接影响。`CUTOVER_TIMEOUT` 500ms 说明设计者认为切回直连应该很快，超时就放弃本次尝试。
- **配对是 6 位码**：100 万分之一的空间，`PAIR_ATTEMPTS = 3`（`limits.rs`）限制尝试次数，`PAIR_PROGRESS_SECONDS = 10` 限制单次尝试时长。这是"可用性 vs 安全"的经典折中——6 位码比 4 位安全，比 8 位好念。

## 取舍与局限

**取舍 1：单线程换可预测性，付出的是吞吐上限**。多线程 + 每链路独立 runtime 能跑更多设备，但锁竞争和调度抖动会直接进输入延迟。Oink 选前者。

**取舍 2：固定拥塞窗口换稳定延迟**。自适应拥塞控制能利用更多带宽，但在局域网里带宽从来不是瓶颈，延迟才是。

**取舍 3：不自己实现可靠传输**。这意味着 Oink 的可靠语义只能到"QUIC 流"这个粒度——不能做"部分可靠"（比如"这条消息可靠但允许乱序"）。`Delivery` 只有两档就是这个约束的直接后果。

**取舍 4：中继只有一跳**。多跳 relay 能覆盖更复杂的拓扑，但会引入环路检测、路径选择、故障传播三个新问题。一跳是"够用且能想清楚"的选择。

**局限**：`待查实`——relay 的实际转发实现在本次分析中没有逐行读完（`crates/oink-network/src/link/` 下文件较多），文档只基于模块文档与常量。另外"中继节点的选择策略"（谁当中继）在代码里的具体规则待查实。

## 我能偷什么

1. **"设置后立刻读回"**：任何向 OS 申请资源/优先级的操作，都应该读回验证并持续复查。这是把"配置"变成"可观测事实"的最小成本做法。
2. **分段时间预算 + 未用完结转**：`[OWN, INTERACTIVE, NORMAL]` 三段，前一段没用完的时间自动给后一段。比"每类工作固定配额"更适应负载波动。
3. **CAS 抢占，失败即放弃**：实时路径上的共享槽位，抢不到就是"这轮没数据"，绝不自旋。自旋在实时系统里等价于主动制造延迟。
4. **transcript 绑定"角色 + attempt"**：任何基于短码的配对协议都应该绑这两样，否则角色反射和重放都成立。
5. **"证书结构解析优先于字节匹配"**：从证书取身份时先解析 ASN.1 结构再取 SPKI，不要在一整块字节里搜公钥。
6. **流类型即优先级**：优先级不要做成可配置项，做成类型的函数——少一个能配错的地方。

## 一句话记住

Oink 的网络层用一句话概括：**把所有不确定收进一个单线程 owner，用 500µs 分三段跑，可靠性全给 QUIC，身份全给证书 SPKI，配对全给 SPAKE2 的 transcript**——它没有发明任何协议，只是把每个已有协议放在了正确的位置。
