# 03 代码走读：从 main 到一次跨屏按键

## 这篇回答什么问题

想读 Oink 的代码，从哪个文件开始、按什么顺序读、主流程在函数级是怎么走的、想加一个功能要动哪几个文件、测试怎么跑。

## 仓库目录树（只列有意义的层）

```
oink/
├── Cargo.toml                    # workspace：16 members + src-tauri + tests/support
├── rust-toolchain.toml           # channel 1.99.0，含 rustfmt/clippy
├── crates/
│   ├── oink-foundation/          # 共享类型、paths、realtime、snapshot、input 定义
│   ├── oink-protocol/            # v1 线协议：frame、limits、dto、registry_entries、layout
│   ├── oink-routing/             # 纯状态机 + router/ 下 30+ 子模块
│   ├── oink-input/               # 采集/注入，macos/ windows/ 平台实现
│   ├── oink-display/             # 显示器枚举与布局
│   ├── oink-locator/             # 光标拖尾绘制
│   ├── oink-network/             # link/ discovery/ pairing/ group_pake/ roster/ qos
│   ├── oink-clipboard/           # content/（Provider、namespace、grants、transfer）、dedupe、paste_file
│   ├── oink-audio/               # dsp、media_pause、claims、capture_permission
│   ├── oink-winsvc/              # Windows SYSTEM 服务；native/ 下 C++（unlock.cpp 等）
│   ├── oink-agent/               # 组合层：node、threads、streams、api、diagnostics、auto_unlock
│   ├── oink-telemetry/ oink-crash/ oink-update/ oink-autostart/
│   └── oink-credential-provider/ # ⚠ C++，不在 workspace members
├── apps/
│   ├── oink/                     # React 19 + Tauri 2；src/ 227 个 TS/TSX（106 个测试）
│   ├── oink/src-tauri/           # 壳：主窗口、macOS 菜单栏、Windows 托盘、启动 backend
│   └── finder-sync/              # Swift Finder 扩展（0.3.4+）
├── packaging/                    # macos/（signing、notarize、dmg）、windows/（wxs、CA、PasteMenu）
├── build-support/                # ci.py、package.py、update/（feed 签发）
└── .github/workflows/            # ci.yml + 6 个 feed/release workflow
```

## 构建与运行入口

| 入口 | 文件 | 说明 |
|---|---|---|
| 后端进程 | `crates/oink-agent/src/backend/main.rs` | `[[bin]] oink-backend`（`crates/oink-agent/Cargo.toml:113-116`）；先 `process::initialize_priority()`，再按参数决定 `Launch::User` / `Launch::Reopen`，最后 `backend::run(launch)` |
| CLI | `crates/oink-agent/src/main.rs` | 同一个库的另一个 bin；所有子命令（`run`/`status`/`layout`/`diagnostics`/`audio`/`paste-as-file`…）都走**同一套认证 IPC**，不绕过服务 |
| 前端 | `apps/oink/src/main.tsx` | Vite dev server 在 `http://127.0.0.1:1440` |
| Tauri 壳 | `apps/oink/src-tauri/src/main.rs` → `app.rs` | 开窗口/菜单栏/托盘，**在独立进程启动 backend**，通过 `AgentApi` IPC 通信 |

`oink-agent/src/main.rs:1-2` 的注释值得记住：「Product command line. Calls use the same authenticated IPC as the UI.」——CLI 不是后门，它和 UI 走同一个入口，所以任何 CLI 能做的事都必须先通过 IPC 认证。这让"调试用后门"这类常见隐患在架构上不存在。

## 主流程走读：一次跨屏按键

以"Mac A 上按住 Shift，指针移到 Windows B，敲一个键"为例。

### 第 1 步：采集（input 线程，realtime）

- `crates/oink-input/src/capture_loop.rs` 拿到平台回调，转成 `CapturedEvent`（`oink_foundation::input` 里的统一类型）。
- `oink-input` 的职责边界写在 `crates/oink-input/src/lib.rs:1-4`：「平台实现只做翻译，不做路由决策」。

### 第 2 步：路由（同一个 input 线程）

- 调用 `Router::on_local_event(ev, now)`（`crates/oink-routing/src/router.rs:1644`）。
- 返回 `Disposition`：`Local`（本机注入）、`Forward`（发给某设备）、`Refused`（丢弃并留下原因）。
- 焦点已经在 B 上，所以按键走 `local_key`（`router.rs:2186`）→ 产生 `Output::Send{to: B, msg, Delivery::Reliable}`。

### 第 3 步：边缘穿越（如果这次是移动导致移交）

- `local_motion`（`router.rs:1908`）→ `resistance::damping_rule`（`crates/oink-routing/src/router/resistance.rs:32`）判断"这个边缘要不要抵抗"。
- 决定移交时走 `hand_off_with_entry`（`router.rs:3823`）：递增 `epoch`、`suspend_focus_lock()`、发 `handoff_timing` 事件、取 `focus_scope`、把拖拽的 `DndEnter` 先发出去、然后发 `ControlMsg::MovePointerEnter`。
- 注意顺序：`self.take_dnd_enter(to, epoch)` 在 `MovePointerEnter` 之前——拖拽进场的消息必须先到，否则对端会先收到指针进入再收到拖拽，中间会闪一下。

### 第 4 步：出队与发送

- input 线程调 `drain_outputs()`（`router.rs:1575`）拿到 `Vec<Output>`，把 `Send` 项塞进对应流的发送队列。
- 网络线程（单线程 runtime）在自己的轮次里读队列。一轮的结构在 `crates/oink-network/src/link/runtime.rs:270-310`：两次 `yield_now` → macOS rebind socket（放在 Quinn socket 回调外）→ 记 `began` → `tick`/`probe_tick`/`retry_n1`/`effects` → 按三段预算 `service(0/1/2)` → `check_drained` → 统计 `over_budget` → `realtime::read_back()` 比对调度是否被降级。

### 第 5 步：对端接收与注入

- B 的 input 线程收到 I1 流上的消息，`Router::receive_message(from, msg, now)`（`router.rs:1843`）→ `Output::Inject`。
- injection 线程调 `CGEventPost` / `SendInput`（`crates/oink-agent/src/threads/inject.rs`），并记下"这个键是我注入的"，防止自己的钩子再抓一遍形成回环。

### 第 6 步：状态收敛

- 两端各自维护 `epoch`、`focus_scope`、`holder`；心跳（500ms 间隔、2s 超时，`crates/oink-network/src/link/mod.rs:53-55`）维持"对端还活着"的判断，`peer_alive`（`router.rs:1086`）据此决定是否降级。

### 失败路径：一次没送到的按键

正常路径之外，更值得读的是拒绝路径。`on_local_event`（`router.rs:1644`）的注释写着「截获回调的快路径：立即决定吞掉还是放行；其余动作进入输出队列」——也就是说，捕获回调里绝不等待、绝不发网络包，只做"吞/放"这个二选一，真正的转发排到后面。

当一次转发被拒绝时，`DecisionKind::Refused` 会带一个 `DecisionReason` 进诊断流（`router.rs:2064-2091`）：`NoTarget`（没有可用目标）、`Resistance`（边缘抵抗）、`HeldButtons`（按着键不允许移交）、`Paused`（暂停中）、`Stale`（对端状态过期）、`PreviousInstance`（旧实例残留）、`NotControllable`（目标不可控）。这些原因不是给用户看的，是给"为什么这次按键没过去"这个问题留证据的——每一条都能对应到一个具体的状态判断。

`Stale` 尤其重要：设备断线后，路由表里可能还留着旧目标。`peer_alive` 返回 false 时，路由不会"试着发一下"，而是直接拒绝并记下原因。**宁可本地吞掉，也不把按键发给一个可能已经不存在的设备**——因为发出去的按键如果在对端恢复后被重放，就是一次无法解释的输入。

## 先读的 12 个文件

按顺序读，每个一句话说为什么。

| # | 文件 | 为什么读它 |
|---|---|---|
| 1 | `crates/oink-agent/src/threads/mod.rs` | 17 行的线程所有权表，读完知道"谁能碰实时路径"，后面所有模块的边界都由它定义 |
| 2 | `crates/oink-routing/src/router.rs`（前 500 行） | `Delivery` / `DecisionKind` / `DecisionReason` / `Output` 四个枚举就是整个系统的词汇表 |
| 3 | `crates/oink-routing/src/layout.rs`（131 行） | 屏幕拓扑的唯一抽象，`LayoutQuery` trait 的"必须纯计算"注释解释了整个设计的约束 |
| 4 | `crates/oink-network/src/link/mod.rs`（前 120 行） | 模块文档 + 15 个常量，网络层的所有时间尺度都在这里 |
| 5 | `crates/oink-protocol/src/frame.rs` | 流类型表（N0/N1/C0/I0/I1/B0/M0/M1/D0/D1…）和两档优先级 |
| 6 | `crates/oink-protocol/src/v1/limits.rs` | 一张表管所有协议上限；想知道"为什么是 1100 字节"看这里 |
| 7 | `crates/oink-network/src/link/runtime.rs:270-310` | 500µs 预算怎么分段花的实际代码 |
| 8 | `crates/oink-agent/src/node.rs`（前 120 行） | `Profile::User` vs `Prelogin`：Windows 登录前只装哪些组件 |
| 9 | `crates/oink-network/src/group_pake.rs`（前 60 行 + 3 个测试） | SPAKE2 配对，6 位码 + transcript 绑定角色/attempt |
| 10 | `crates/oink-clipboard/src/content.rs`（Provider trait 与 `projected()`） | 剪贴板"懒加载 + 授权"的核心：设置投影即服务授权 |
| 11 | `crates/oink-audio/src/dsp.rs`（前 30 行常量） | 48k/Opus 10ms/960B/3-12 帧队列/6 帧 PLC，一套有界音频参数 |
| 12 | `crates/oink-agent/src/auto_unlock/sync.rs`（前 200 行） | 0.3.5 的同步解锁：重放栅栏 + 两段式确认，最值得抄的信任边界 |

## 关键类型与签名

```rust
// crates/oink-routing/src/router.rs
pub type Micros = u64;                                    // :76  时间由调用方给

pub enum Delivery { Datagram, Reliable }                  // :94
pub enum DecisionKind {                                    // :104
    Handoff, Refused, Lock, Unlock, ReturnHome, FocusAccepted, GapDepart, GapReturn,
}
pub enum Output {                                          // :215
    Send { to: DeviceId, msg: Message, delivery: Delivery },
    Inject, LockWindows, SetMode, RestoreLocal { at: Micros },
    Status, Dnd, CursorTrail, /* … */
}

impl Router {
    pub fn on_local_event(&mut self, ev: &CapturedEvent, now: Micros) -> Disposition;  // :1644
    pub fn receive_message(&mut self, from: DeviceId, msg: Message, now: Micros);      // :1843
    pub fn tick(&mut self, now: Micros);                                              // :1857
    pub fn drain_outputs(&mut self) -> Vec<Output>;                                   // :1575
    pub fn next_deadline(&self) -> Option<Micros>;                                    // :1586
}
```

```rust
// crates/oink-routing/src/layout.rs
pub trait LayoutQuery {
    fn contains_device(&self, device: DeviceId) -> bool;
    fn step(&self, from: ScreenPos, dx: f64, dy: f64) -> StepResult;
    fn exit_through_edge(&self, from: ScreenPos, normal: (f64, f64)) -> Option<ScreenPos>;
    fn gap_topology(&self) -> /* … */;
    // 实现必须是纯计算：会在截获回调的快路径里调用
}
```

```rust
// crates/oink-network/src/link/mod.rs
pub struct LinkLayer(Arc<handle::Shared>);                // :118 可克隆句柄，方法不等网络线程
pub struct LinkConfig {                                    // :92
    pub profile: OfferProfile, pub identity: Arc<Identity>,
    pub boot: Boot, pub bind: SocketAddr, pub tier: Tier,
}
```

```rust
// crates/oink-agent/src/auto_unlock/sync.rs
struct SyncGate {                                          // :144
    seen: HashMap<DeviceId, (Boot, u64)>,                  // 重放栅栏：同 boot 下 epoch 必须更新
    next_query: u64,
    pending: Option<Pending>,
}
impl SyncGate {
    fn admit(&mut self, source: DeviceId, boot: Boot, epoch: u64) -> bool;      // :160
    fn begin(&mut self, source: DeviceId, reply: SyncSender<SourceAnswer>, now: Instant) -> u64;  // :169
    fn confirm(&mut self, source: DeviceId, query: u64, unlocked: bool, locked: bool, now: Instant) -> bool;  // :183
}
```

## 如果要加一个功能，改哪几个文件

### 例：新增一个"快捷键触发某动作"

1. `crates/oink-foundation/src/input.rs` — 如果需要新的按键/手势类型。
2. `crates/oink-routing/src/router.rs` 的 `Output` 枚举 — 新动作作为一个 `Output` 变体。
3. `crates/oink-routing/src/router/mouse_hotkeys.rs`（或 `keyboard.rs`）— 匹配逻辑；注意 60s 租约模式（`now.saturating_add(60_000_000)`），防止录制器断连后永久拦截点击。
4. `crates/oink-agent/src/threads/input.rs` — 执行 `Output` 变体的地方。
5. `crates/oink-routing/src/router/*_tests.rs` — 加虚拟时钟下的回归。

### 例：新增一个跨设备数据流

1. `crates/oink-protocol/src/frame.rs` — 加 `StreamKind`（注意 6 是保留值，别占）。
2. `crates/oink-protocol/src/v1/limits.rs` — 加帧上限。
3. `crates/oink-protocol/src/v1/registry_entries.rs` — 加消息 ID + kind + transport + capabilities。
4. `crates/oink-agent/src/streams/mod.rs` 的 `RULES` 表 — 声明 `obeys_pause` 和 `OpenWhen`（`Allowed`/`FirstUse`/`PerSend`）。
5. 新模块 `crates/oink-agent/src/streams/<name>.rs` — 自己的 outbound 流自己开、自己退。

## 测试在哪里，怎么跑

| 层 | 位置 | 命令 |
|---|---|---|
| 路由状态机（纯逻辑，无需图形环境） | `crates/oink-routing/src/router/*_tests.rs` + `crates/oink-routing/tests/` | `cargo test -p oink-routing` |
| 协议编解码与 golden | `crates/oink-protocol/tests/v1_*.rs` + `fixtures/` | `cargo test -p oink-protocol` |
| 0.3.x 线协议兼容 | `crates/oink-agent/tests/c0_compat.rs` + `fixtures/compat/` | `cargo test -p oink-agent --test c0_compat` |
| 前端 | `apps/oink/src/**/*.test.tsx`（106 个） | `npm run -w apps/oink test`（慢测 `test:slow`） |
| 全量 CI 等价 | `build-support/ci.py` | `python build-support/ci.py`（跑 clippy -D warnings、test、check --release、test --release --lib） |
| 慢测/设备测 | `--slow` 开关 | `python build-support/ci.py --slow` |

CI 的完整矩阵在 `.github/workflows/ci.yml`：macos-15 aarch64、macos-15-intel x86_64、windows-2022 x86_64-msvc，timeout 120min，Rust 1.99.0 + Python 3.14.6 + Node 24.14.1，最后跑 `cargo deny check`。

## 一句话记住

读 Oink 的顺序应该是"先读边界、再读流程"：`threads/mod.rs` 的 17 行表 + `router.rs` 前 500 行的四个枚举 + `frame.rs` 的流类型表，三处读完，剩下的 44 万行都只是这三处的展开。
