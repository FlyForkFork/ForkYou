# 04 深挖：输入路由——一台纯状态机怎么处理"光标跨屏"这件小事

## 这篇回答什么问题

"光标从这台机器移到那台机器"看起来是个小功能，为什么 Oink 用了一个 4773 行的纯状态机和 30 多个子模块来做？朴素做法在哪失效？这个状态机具体怎么建模边缘、抵抗、接触、游戏模式和掉线？

## 问题是什么

跨设备输入路由要同时满足一组互相冲突的约束：

1. **按键不能丢**：按住 Shift 跨屏，Shift 的按下在 A、抬起在 B，B 必须知道 Shift 是按着的。
2. **不能重复**：A 上的键已经转给 B 了，A 自己不能也响应。
3. **边缘要"粘"**：用户经常只是把光标推到边上想点滚动条，不是想换设备。
4. **触控板是流不是点**：多指手势中途换设备，手指还在玻璃上，接收方不能凭空开始一个手势。
5. **游戏要相对运动**：FPS 里鼠标是无限转的，绝对坐标会让视角瞬移。
6. **掉线要能收尾**：对端消失时，按住的键必须被释放，否则变成"幽灵按键"。

这六条每一条都会和其他条打架。最典型的冲突：为了"边缘要粘"，光标会在边界上停留几百毫秒；而用户真的想过去时，这几百毫秒就是延迟。

## 朴素做法为什么不够

| 朴素做法 | 失效点 |
|---|---|
| 在回调里直接判断 `if x >= screen.width - 1 { switch_to(next) }` | 没有"意图"概念，滚动条、关闭按钮、Dock 自动隐藏都在边缘，每次都是误切 |
| 用全局 `Mutex<State>` 保护路由状态 | 回调在 OS 的输入线程上，任何一次锁等待都直接变成输入延迟 |
| 读 `Instant::now()` 做超时判断 | 无法在 CI 里重放；两台虚拟设备的时序测不出来 |
| 在路由逻辑里直接调 `CGEventPost` | 无法测试"如果当时注入失败会怎样"；也无法在同一进程里模拟两个设备 |
| 用 `(dx, dy)` 增量做所有移动 | 跨屏后绝对位置丢失，光标在对端会从 (0,0) 开始 |

Oink 的选择是把这五条全部反过来：**状态机不碰系统、时间由调用方给、副作用变成返回值、位置用绝对坐标 + 增量修正、意图用"抵抗"建模**。

## 核心机制

### 1. 纯状态机：输入事件 + 对端消息 + 定时器 → 输出命令

`crates/oink-routing/src/router.rs:1-5` 的模块文档是这个设计的合同：

> 实现为与系统和网络无关的状态机（输入事件、对端消息、定时器 → 注入、发送、模式切换），构造时生成随机实例标识。

三个入口：`on_local_event(ev, now)`（`router.rs:1644`）、`receive_message(from, msg, now)`（`router.rs:1843`）、`tick(now)`（`router.rs:1857`）。一个出口：`drain_outputs() -> Vec<Output>`（`router.rs:1575`）。一个"我下次想被叫醒的时间"：`next_deadline()`（`router.rs:1586`）。

`Micros` 是 `u64`（`router.rs:76`），注释直接写「由调用方提供（服务进程用真实时钟，模拟器用虚拟时钟）」。这就是可测试性的全部秘密——不需要 mock 时钟，时钟是参数。

`Output` 枚举（`router.rs:215`）包含 `Send{to,msg,delivery}`、`Inject`、`LockWindows`、`SetMode`、`RestoreLocal{at}`、`Status`、`Dnd`、`CursorTrail`、`CursorTrailResume`、`CursorTrailResumeClipped`、`CursorTrailDepart`、`UserActivity`、`LocalUserActivity`、`ResetUserIdle`、`ExitVolumeKey`。每一个都对应 input 线程里的一个执行分支。**这个枚举就是路由子系统的公开 API**，想加行为就得加变体，编译器会强制你去实现它。

### 2. 边缘不是一条线，是一个"抵抗"模型

关键在 `crates/oink-routing/src/router/resistance.rs`。`damping_rule`（`resistance.rs:32`）决定"这个边缘要不要抵抗"，它的逻辑值得逐句读：

- 如果用户在设置里配了 `damping.rules`（`settings.damping.rules`），就按"段"匹配：`rule.segment.matches(设备, 目标设备, 显示器, 边, 边上位置比例)`，第一个匹配的手动段获胜，**跨平台一致**（注释原文：「Select WHERE independently from WHAT; first matching manual segment wins on every OS」）。
- 没有手动规则时，只有两种情况要抵抗：目标是受保护的进入点（`protected_entry(screen)`），或 macOS 上的保留边缘（`reserved_edge`）。

`DampingMeter` 和 `DampingProfile` 在 `crates/oink-routing/src/damping.rs`，用 `BIN_US = 10_000`（10ms 分箱）和 `DT = 0.01` 做累积——也就是说抵抗强度是**按时间积分的位移**，不是"碰到线就拦"。这个建模的直接后果：慢慢推过去会被拦住，快速甩过去会穿过。这就是"粘"和"能过去"的共存方式。

边缘本身的几何在 `crates/oink-routing/src/router/edge.rs`。`ExitEdge` 有 `source`、`normal`、可选的 `Portal`；`contains(b, p)` 用 `EDGE_UNITS`（= 1.0，`router.rs:86`）判断"停在边上"，注释解释了为什么是 1.0：macOS 光标最多到 `right - ε`，Windows 到 `right - 1`。

`edge.rs` 里最细的一段是 `target_readback_constrained_point`：macOS 会把光标夹到"向内的小数/最后一像素"，和提交的 HID 端点不同；如果不处理，每次远端批次回来都会重置抵抗累积，导致"抵抗永远攒不满"。代码用 `QUANTUM = 1./256.` 按轴分别匹配——保留法向的停靠点，采纳观测到的切向位置，这样"沿边滑动"不会重置压力。

### 3. 触控板：接触不跨焦点边界迁移

`crates/oink-routing/src/router/contacts.rs:1-2` 一句话定规则：

> Contacts never migrate across a focus boundary. Receiver ownership is one source/device pair; a second source cannot splice its fingers into that device.

翻译：一个手势属于"一个源设备 + 一个接收设备"这一对。第二个源不能把自己的手指"接"进那个设备的手势里。这条规则解决的是一种极难复现的 bug：A 上两指滚动还没抬手，焦点被 B 抢走，C 又发来接触帧——如果不做归属，接收方会看到一个三根手指的"缝合怪"手势。

`ContactsPath` 枚举（`contacts.rs:10-15`）记录了四种路径：`NativeContacts`（原生接触转发）、`CaptureUnavailable`（抓不到）、`AwaitLift`（等抬手）、`Local`（本机处理）。`TouchpadRoute` 用一个 `[u64; 13]` 定长数组记录诊断字段，注释写明「Transient diagnostic observation. The consumer anonymizes source; never wire input」——诊断数据结构本身是定长的，因为它会在快路径上被填充。

### 4. 游戏模式：设备自有，焦点范围受限

`crates/oink-routing/src/router/game.rs:1-2`：

> Device-owned game mode with focus-scoped relative input. Only a held escape key plus fresh native edge evidence invokes normal crossing geometry.

两个设计点：

- **设备自有**（`OwnerGameState`）：本机的游戏模式策略和抓取状态**活过**组指针的访问。远端持有者的公告只更新焦点快照，永不改本机状态（`game.rs:28-31` 注释）。这意味着"我这台机器开了游戏模式"不会被别的设备改掉。
- **逃逸要双证据**：想从游戏模式里把光标移出去，需要"按住逃逸键"**且**"新鲜的本地边缘证据"。只有按住键不够——很多游戏自己会用到那个键。

相对运动走 `Delivery::Datagram`（`router.rs:94`），因为迟到即无意义。`RELATIVE_SYNC_EVERY = 2`（`router.rs:90`）表示每两轮补一次绝对同步，防止相对误差累积。

### 5. Gap travel：设备之间可以有物理间隙

`crates/oink-routing/src/router/gap.rs:1-2`：

> Optional physical travel between devices. Focus stays on the leaving screen; only the trail uses the virtual, off-screen head. No transport state is added.

用户把两台机器摆得中间有空隙时，光标可以在"虚拟空间"里飞过空隙，这期间焦点**还在离开的那块屏上**，只有拖尾（trail）用那个虚拟头。关键约束是最后一句：**不新增传输状态**。如果为了"飞行中"新增一个连接状态，网络层就要多一个状态机；Oink 选择让这段飞行纯粹是本地视觉效果 + 一个 `GapDepart` / `GapReturn` 决策对。

`ZoneTravel::entry_time`（`gap.rs:20`）用射线与矩形面的交点算"什么时候会撞上目标侧面"，只在 `0..=1` 参数区间内且落点在目标边上才算命中——这就是"擦边过"也能接管的原因，同时不会误判"从旁边飞过"。

### 6. 掉线与防卡键

- `peer_alive(peer)`（`router.rs:1086`）由心跳驱动（500ms 间隔 / 2s 超时，`crates/oink-network/src/link/mod.rs:53-55`）。
- 对端消失时，按住的键必须释放：`release_local_key`（`router.rs:2303`）、`release_local_button`（`router.rs:2157`）、`release_local_passed_key`（`router.rs:1624`）。
- `trigger_emergency`（`router.rs:1379`）/ `apply_emergency`（`router.rs:1396`）：一个"紧急收回"路径，把焦点强制拉回本机。`mouse_hotkeys.rs` 里 `action == "pause_all"` 就调它。
- `set_paused` / `set_fully_paused` / `set_input_suspended`（`router.rs:1092/1143/1152`）是三个不同层级的暂停：暂停路由、完全暂停（含媒体）、暂停输入但保留其他。

### 7. 鼠标快捷键的 60 秒租约

`crates/oink-routing/src/router/mouse_hotkeys.rs`（109 行，0.3.4 新增）里有一个小而重要的模式：

```rust
// 录制器持有租约；断连后最多 60 秒自动失效
now.saturating_add(60_000_000)
```

为什么需要：把鼠标中键/侧键配成快捷键后，如果"正在录制快捷键"的状态因为 UI 崩溃或 IPC 断连没有清掉，那个键会被永久拦截，用户的鼠标就废了。租约把"永久"变成"最多 60 秒"。这是一个**防御性超时**，不是功能需求——但正是这类地方决定了一个输入软件能不能日常用。

## 代码证据

| 事实 | 位置 |
|---|---|
| 纯状态机、不读系统时钟、随机实例标识 | `crates/oink-routing/src/router.rs:1-5` |
| 时间类型由调用方注入 | `crates/oink-routing/src/router.rs:76` |
| 两档投递语义 + Reliable 的保序承诺 | `crates/oink-routing/src/router.rs:94` |
| 决策种类与原因枚举 | `crates/oink-routing/src/router.rs:104-129` |
| 副作用出口 `drain_outputs` / `next_deadline` | `crates/oink-routing/src/router.rs:1575,1586` |
| 抵抗规则选择（手动段优先，跨平台一致） | `crates/oink-routing/src/router/resistance.rs:32-59` |
| 抵抗按 10ms 分箱积分 | `crates/oink-routing/src/damping.rs:145-146` |
| 接触不跨焦点边界迁移 | `crates/oink-routing/src/router/contacts.rs:1-2` |
| 游戏模式设备自有 + 逃逸双证据 | `crates/oink-routing/src/router/game.rs:1-2,28-31` |
| gap travel 不新增传输状态 | `crates/oink-routing/src/router/gap.rs:1-2` |
| 鼠标快捷键 60s 租约 | `crates/oink-routing/src/router/mouse_hotkeys.rs` |
| `LayoutQuery` 必须纯计算 | `crates/oink-routing/src/layout.rs` |

## 复杂度与边界条件

- **单次事件处理**：`on_local_event` 的最坏路径涉及抵抗积分、拓扑步进、可能的焦点移交（含 `epoch` 递增与多个 `Output` 生成）。没有全局锁，没有 I/O，没有分配（除了 `drain_outputs` 的 `Vec`）。
- **`Vec<Output>` 的分配**：`drain_outputs` 每次返回新 `Vec`。在 125Hz 指针预算下（`crates/oink-agent/src/main.rs:96` 提到默认 `hz125`），这是每秒 125 次小分配——可接受，但不是零成本。如果要榨，可以改成复用缓冲。
- **子模块数量是复杂度信号**：`router/` 下有 30+ 文件，其中测试文件（`*_tests.rs`）占了一半以上。`dnd.rs` 4491 行、`contacts.rs` 2301 行、`focus_lock.rs` 1823 行——这三个是真正的复杂度热点，也对应三种最容易出 bug 的交互。
- **边界条件清单**（从 `DecisionReason` 反推）：`EdgeCrossed` / `Locked` / `Paused` / `GameMode` / `HeldButtons` / `NotControllable` / `Resistance` / `PreviousInstance` / `Stale` / `Accepted` / `UserRequest` / `GapTravel` / `NoTarget`。这 13 个原因就是"拒绝或移交"的完整分类，写测试时按这个表逐条覆盖即可。

## 取舍与局限

**取舍 1：纯状态机换来可测性，付出的是"所有副作用都要建模"**。`Output` 枚举每加一个变体，input 线程的执行器、测试、诊断都要跟着改。如果路由逻辑简单，这个成本不划算；但 Oink 有 13 种拒绝原因和 8 种决策种类，不建模就是灾难。

**取舍 2：抵抗用时间积分，调参敏感**。`DampingProfile` 是用户可配的（`settings.damping`），意味着默认值必须覆盖大多数人的手感。这是"物理世界需要标定"的典型——不存在一个数学上正确的默认值。

**取舍 3：gap travel 只是视觉效果**。它不改变任何网络/传输状态，所以"在空隙里飞行时"如果对端掉线，行为是"回到离开的屏幕"，而不是"卡在中间"。这个选择让状态机少一个状态，代价是飞行中的体验不能做太复杂（比如不能在半空中改变目标）。

**局限**：整套机制假设"每台设备的屏幕几何是已知且相对稳定的"。显示器热插拔、分辨率变化、DPI 缩放变化都会触发 `set_local_displays`（`router.rs:821`）重建拓扑。这部分在 `crates/oink-display` 里，Windows 侧 0.3.4 新增了 `visibility.rs`（918 行）专门处理"仅会话内移除目标 + 精确模式重连"，因为 Windows 的 `QueryDisplayConfig` 返回的 mode-array 索引不稳定，必须只存稳定值。

## 我能偷什么

1. **"时间作为参数"是可测性的杠杆**。不需要 mock 框架，把 `now` 放进签名，测试里传虚拟时钟。任何有超时/节流/积分的状态机都适用。
2. **把"拒绝原因"做成枚举**。大多数人只建模"成功路径"，Oink 的 `DecisionReason` 13 个值让每个"为什么没过去"都能被记录、被测试、被用户看到。
3. **防御性租约**：任何"临时拦截用户输入"的状态都要有自动过期。60 秒这个数字不重要，"有上限"这件事重要。
4. **边缘抵抗用积分不用阈值**。阈值只能表达"过/不过"，积分能表达"慢推被拦、快甩能过"——这是手感的来源。
5. **归属不可迁移**：给"多源共享一个接收者"的场景定义一条不可协商的所有权规则（这里是 source/device 对），比事后做冲突合并简单一个数量级。

## 一句话记住

Oink 的路由不是"判断光标该去哪"，而是"用可重放的状态机 + 按时间积分的边缘抵抗 + 不可迁移的接触归属，把六条互相冲突的交互约束同时满足"——它值 4773 行，是因为每一条约束都有对应的失败模式。
