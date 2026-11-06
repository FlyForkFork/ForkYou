# 04 深挖 A：输入路由——把“跨屏”做成纯状态机

> 这是 Oink 最值得学的部分。它不是“网络转发键鼠”，而是一个**可测试的、无 I/O 的输入路由决策核心**。

## 问题：多机 KVM 的输入路由为什么难

一台机器的输入要跨到另一台，至少要同时处理：

1. **屏幕拓扑**：多显示器、不同 DPI、不同分辨率、屏幕怎么摆、边缘怎么接。
2. **焦点/控制权**：当前哪台设备拥有输入；切换时谁先收到“释放”，谁后收到“按下”。
3. **按键保持**：跨屏时 Shift/Ctrl/鼠标按键还按着，不能丢，也不能重复。
4. **触控板手势**：单指移动、双指滚动、多指手势，跨设备时不能把“半截触摸”传过去。
5. **游戏模式**：相对运动必须低延迟，迟到就无意义；不能用可靠有序流。
6. **异常路径**：对端掉线、连接切换、窗口失焦、锁屏、用户暂停。

如果把这些逻辑写进“收到事件就发网络包”的回调里，代码会迅速变成一堆 `if` + 共享状态 + 锁，测试只能靠两台真机。

## Oink 的做法：纯决策核心 + 命令式外壳

`crates/oink-routing/src/router.rs:1-5` 的模块文档把边界写得很清楚：

> Pure input-routing state machine.
> 输入：本机截获事件（同步快路径，立即返回 `Disposition`）、对端消息、连接/断开、时钟。
> 输出：`Output` 队列（发送消息、注入、切换截获模式、状态通知），由调用方用 `Router::drain_outputs` 取走后异步派发。
> 运行时状态转换不做 I/O、不读系统时钟；构造时生成一次随机进程实例标识。

这句话包含三个重要设计：

- **输入是数据**：本机事件、对端消息、连接状态、时间，全部作为参数传入。
- **输出是数据**：router 不直接发网络包、不直接注入，只产出 `Output` 队列。
- **副作用在外部**：agent 的 input 线程取走 outputs，再执行网络发送/注入/状态通知。

### 为什么这很重要

纯函数意味着可以用“事件序列 + 虚拟时钟”复现任何 bug。`router.rs` 底部有大量 `#[test]`，覆盖跨边、按住键、触控板、游戏模式、焦点锁等；测试不需要真实桌面。这是把“系统级难题”降维成“状态机测试”的典型手法。

代价是：所有环境都必须显式建模，类型多、参数多；第一次读会觉得“怎么这么多 struct”。但这是为可测试性和可推理性付的税。

## 关键类型

### `Delivery`：可靠 vs  datagram

`router.rs:94-102`：

```rust
pub enum Delivery {
    /// 不可靠、低延迟（QUIC datagram）：游戏模式 RelativeMotion。
    Datagram,
    /// 可靠，且发往同一设备的所有 Reliable 消息保持发送顺序：
    /// 焦点移交必须先于随后的按键到达。
    Reliable,
}
```

这是整个路由最重要的一个“协议级”决策：

- **Reliable**：键盘、按钮、焦点移交。必须有序，否则会出现“先收到按键，后收到焦点”的鬼故事。
- **Datagram**：游戏相对运动。迟到就无意义，宁可丢，不要排队。

把“可靠性”做成显式的消息属性，而不是全局开关，是很多实时系统可以抄的作业。

### `DecisionKind`：路由决策是可枚举的

`router.rs:104-112`：

```rust
pub enum DecisionKind {
    Handoff,
    Refused,
    Lock,
    Unlock,
    ReturnHome,
    FocusAccepted,
    GapDepart,
    GapReturn,
}
```

每个决策都对应一个用户可见的状态变化：移交控制、拒绝（比如按键还按着）、锁定、解锁、回到本机、接受焦点、跨间隙离开/返回。**决策类型少而明确**，让 UI、日志、测试都能围绕它做文章。

### `LayoutQuery`：窄接口

`crates/oink-routing/src/layout.rs:1-7` 说明坐标约定：

- **视平面（plane）**：所有电脑的所有屏幕放在同一平面，参考单位，y 向下。
- **本机全局坐标**：macOS 用 point，Windows 用物理像素。

`LayoutQuery` 只暴露 router 需要的东西（`layout.rs:56-121`）：

- `to_plane` / `from_plane`：本机坐标 ↔ 视平面。
- `step(from, delta)`：从某点移动，返回终点、途中穿过的屏幕、是否撞墙。
- `exit_through_edge`：本机光标是否穿过边缘进入另一块屏幕。
- `reference_per_native_unit`：每个本机单位对应多少“手部平面”位移（含每屏增益）。
- `first_portal` / `gap_topology`：传送门/间隙旅行。

关键约束：**实现必须是纯计算，会在截获回调的快路径里调用**（`layout.rs:55`）。所以不能在这里读文件、查数据库、等锁。

### `Contacts`：触控板状态机

`crates/oink-routing/src/contacts.rs:1-12`：

```rust
//! Single-finger motion stays on the pointer path; contacts never synthesize it.
pub enum Mode {
    Ready,
    Single,
    Raw,
    /// A boundary or capture fault cannot transfer a partially completed touch.
    AwaitLift,
}
```

这段注释值得抄进任何跨设备输入项目：

- 单指移动走 pointer 路径，不合成 contact。
- 双指/多指进入 `Raw`。
- 一旦跨边界或捕获出错，不能把“半截触摸”传给对端；必须进入 `AwaitLift`，等用户全部抬起再恢复。

测试也直接覆盖了这一点：`contacts.rs:124-163` 有 `cancelled_touch_waits_for_full_lift`、`partial touch crossed focus` 等断言。

## 一次跨屏移动的算法走查

假设 Mac 在左、Windows 在右，Mac 屏幕 2560×1600，Windows 屏幕 1920×1080，用户从 Mac 右侧边缘继续向右移动：

1. 输入线程收到 `CapturedEvent::PointerMoved(delta)`。
2. Router 调 `LayoutQuery::step(from, delta)`：
   - `to_plane` 把 Mac 本机坐标转成 plane 坐标。
   - 加上 `delta × reference_per_native_unit`。
   - 判断是否穿出当前屏幕；穿出则找相邻屏幕，返回 `StepResult { to, crossed, blocked_x, blocked_y }`。
3. 如果 `crossed` 包含另一台设备，Router 生成 `DecisionKind::Handoff`：
   - 先发 `Delivery::Reliable` 的焦点移交；
   - 后续按键/鼠标事件走同一条有序流。
4. 如果当前是游戏模式，相对运动改成 `Delivery::Datagram`，避免排队。
5. 如果指针撞墙（`blocked_x/blocked_y`），Router 让指针沿墙滑动，不切换设备。
6. 如果对端不可控（`NotControllable`）或按键还按着（`HeldButtons`），返回 `Refused`，不强行移交。
7. 输出队列由 input 线程 `drain_outputs` 取走，异步发送/注入。

这套流程没有锁、没有 I/O、没有系统时钟；时间由调用方以 `Micros` 传入（`router.rs:76`）。

## 复杂度与性能

- 单个输入事件的 router 计算是 O(1) 到 O(屏幕数)；屏幕数通常 < 10。
- `RoutingDiagnostics` 明确要求“fixed-size evidence sink... never allocate, wait or format here”（`router.rs:130`），说明快路径连日志格式化都不做。
- 输入线程是 realtime tier；`threads/mod.rs:5` 说它独占 capture、router、motion pacing、I0/I1。
- 真正的性能数据没有公开 benchmark；这里只能从设计上判断“快路径无分配/无锁/无 I/O”。

## 可迁移的架构经验

1. **Pure decision core + imperative shell**：把“决策”和“执行”分开，决策层不碰 I/O。
2. **可靠性是消息属性，不是全局模式**：`Reliable` vs `Datagram` 按语义选。
3. **异常状态要显式建模**：`AwaitLift` 比“尽力而为地传半截触摸”安全。
4. **布局查询窄接口**：router 不关心 DPI/显示器细节，只问 `step/exit_through_edge`。
5. **测试用虚拟时钟**：`Micros` 由调用方传入，天然可模拟。

## 关键证据

- 纯状态机边界：`crates/oink-routing/src/router.rs:1-5`
- `Delivery`：`crates/oink-routing/src/router.rs:94-102`
- `DecisionKind`：`crates/oink-routing/src/router.rs:104-112`
- 诊断快路径约束：`crates/oink-routing/src/router.rs:130`
- 布局坐标/接口：`crates/oink-routing/src/layout.rs:1-7`、`31`、`56-121`
- 触控板状态机：`crates/oink-routing/src/contacts.rs:1-12`、`124-163`
- 线程所有权：`crates/oink-agent/src/threads/mod.rs:5`
- 游戏模式/相对运动：`crates/oink-routing/src/router/game.rs`
- 焦点锁：`crates/oink-routing/src/router/focus_lock.rs`
