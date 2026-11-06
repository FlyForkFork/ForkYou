# 05 性能：Oink 把哪些东西当成了“实时系统”

> 先给结论：Oink 没有公开 benchmark 数字，本文不编造 FPS/延迟。这里分析的是**代码里已经写死的性能约束**，以及你可以怎么在自己的机器上测。

## 性能敏感路径

| 路径 | 为什么敏感 | 关键代码 |
|---|---|---|
| 输入捕获 → router → 网络 | 键鼠延迟直接可感知；跨屏切换要“跟手” | `crates/oink-agent/src/threads/mod.rs:5`、`crates/oink-routing/src/router.rs:1-5` |
| 网络 → 注入 | 按键/鼠标事件不能排队；焦点移交必须有序 | `router.rs:94-102`、`crates/oink-agent/src/threads/mod.rs:6` |
| 音频采集 → DSP → 网络 → 播放 | 抖动/爆音/延迟非常敏感 | `crates/oink-audio/src/dsp.rs:8-17` |
| 剪贴板/拖拽 | 大文件/图片不能阻塞输入线程 | `crates/oink-clipboard/src/content.rs:101`、`237` |
| 显示布局/投影 | 多屏/DPI 变化要快速重算 | `crates/oink-display/src/layout/` |
| Windows 服务/ IPC | 登录前/提权路径不能卡 UI | `crates/oink-winsvc/src/backend_launch.rs:1` |

## 代码里写死的预算

### 网络线程

`crates/oink-network/src/link/mod.rs:85-90`：

| 预算 | 值 | 保护什么 |
|---|---:|---|
| `ROUND_BUDGET` | 500µs | 一轮循环总上限 |
| `OWN_BUDGET` | 100µs | 心跳/cutover/relay/选择 |
| `INTERACTIVE_BUDGET` | 250µs | 交互流 + datagram |
| `NORMAL_BUDGET` | 150µs | 普通流/命令/新连接 |

设计含义：网络线程不能让某一类流量无限占用。比如大量文件传输（普通流）不能饿死输入（交互流）。

### 连接/心跳

| 常量 | 值 | 影响 |
|---|---:|---|
| `HEARTBEAT_INTERVAL` | 500ms | 断线检测频率 |
| `HEARTBEAT_TIMEOUT` | 2s | 用户感知的断线时间 |
| `IDLE_TIMEOUT` | 10s | QUIC 兜底 |
| `KEEP_ALIVE` | 5s | NAT 保活 |
| `DIAL_BUDGET` | 3s | 单个候选握手 |
| `RELAY_TIMEOUT` | 3s | relay 退化 |
| `CUTOVER_TIMEOUT` | 500ms | relay→direct 切换 |

### 音频

`crates/oink-audio/src/dsp.rs:8-17`：

- 48kHz 立体声。
- Opus 10ms / 128kbps；PCM16 2.5ms / 1.536Mbps；PCM24 无损。
- 单包上限 960 字节（PCM16 stereo 5ms 仍低于 1200 字节路径 MTU，`dsp.rs:13-14`）。
- 目标缓冲 3 帧，最大队列 12 帧，最大 PLC 6 帧。
- `dsp.rs:1589`：deliberate reserve 变化用连续重采样，最多 -0.2%，避免突变爆音。

## 复杂度分析

| 操作 | 复杂度 | 说明 |
|---|---|---|
| Router 单事件 | O(1) ~ O(屏幕数) | 屏幕数通常 < 10；无分配/无锁/无 I/O |
| 布局 `step` | O(屏幕数) | 需要找相邻屏幕/portal；纯计算 |
| 网络一轮 | O(活跃流数) | 受 500µs 预算约束；未完成工作结转 |
| 剪贴板打开 representation | O(1) 索引 + O(内容大小) 读取 | 懒加载，未请求不读 |
| 音频重采样 | O(帧数 × kernel taps) | `dsp.rs` 的 FIR kernel；实时线程内 |
| 协议编码/解码 | O(消息大小) | CBOR/自定义帧；无额外压缩层 |

## 优化手法清单

1. **实时线程不做分配/日志/文件 I/O**：`threads/mod.rs:12-15` 明确禁止。
2. **快照代替锁**：整块替换的只读快照，读侧无锁。
3. **固定尺寸命令**：`LinkLayer` 普通线程只发小命令，不阻塞。
4. **Datagram 分流**：游戏相对运动不排队（`router.rs:94-102`）。
5. **有界队列**：音频 `MAX_QUEUE_FRAMES=12`、`MAX_PLC_FRAMES=6`，超过就丢/PLC，不无限增长。
6. **懒加载剪贴板**：`Provider` 只发布描述，按需读取（`content.rs:101`）。
7. **release 配置**：`Cargo.toml:68-70` 使用 `lto="thin"`、`codegen-units=1`，为发布版优化代码布局/内联。
8. **Windows 固定启动路径**：避免每次启动做昂贵的可执行文件解析/校验（`backend_launch.rs:1`、`20`）。

## 怎么自己测

### 1）Router 微基准

目前没有 `criterion` bench；最直接的是给 `oink-routing` 加一个 `#[test]` 循环，用 `std::time::Instant` 测 100 万次 `router.handle_input(...)`。注意用 release：

```bash
cargo test -p oink-routing --release -- --nocapture
```

### 2）网络回环

仓库有 `tests/support/src/bin/v1-peer.rs` 和 `oink-network` 的 test-support 模块，可以起两个本地 peer 做协议/链路测试。先跑：

```bash
cargo test -p oink-network --release
```

### 3）音频 pull 基准

`crates/oink-audio/native/pull_benchmark.c` 是现成的 native pull 基准；`crates/oink-audio/examples/pull_bounds.rs`、`pull_native_silent.rs` 可以看边界行为。

### 4）布局一致性

`crates/oink-display/examples/layout_conformance.rs` 用于布局一致性；适合验证多屏/DPI 边界。

### 5）端到端

两台真机 + 局域网，测：

- 键鼠跨屏延迟（高速摄像机/慢动作或专用输入延迟测试工具）。
- 大文件拖拽时的输入延迟（是否被普通流饿死）。
- 音频 underrun/overrun 计数（`oink-audio/src/diagnostics.rs`）。
- 断网/恢复时的心跳/relay/cutover 行为。

## 可能的瓶颈与风险

- **单网络线程**：所有 link/stream 在一个线程；极高吞吐（大文件 + 多设备）可能成为瓶颈。代码用 500µs 预算缓解，但没有横向扩展。
- **音频重采样**：FIR 在实时线程内，低端 CPU 可能吃力；`MAX_QUEUE_FRAMES` 限制内存但会增加 PLC。
- **剪贴板大内容**：虽然懒加载，但真正读取大文件仍可能占用 I/O；要看 `grants` 的 bounded fetch 实现。
- **Windows 服务 IPC**：多一层进程/管道，延迟比同进程高；但换来登录前能力。
- **没有公开 benchmark**：所有“性能好”的说法都应以你自己的实测为准。

## 关键证据

- 线程约束：`crates/oink-agent/src/threads/mod.rs:12-15`
- 网络预算：`crates/oink-network/src/link/mod.rs:53-90`
- Router 快路径：`crates/oink-routing/src/router.rs:1-5`、`130`
- 音频边界：`crates/oink-audio/src/dsp.rs:8-17`、`1589`
- 剪贴板懒加载：`crates/oink-clipboard/src/content.rs:101`、`237`
- release 配置：`Cargo.toml:68-70`
- 音频基准：`crates/oink-audio/native/pull_benchmark.c`、`crates/oink-audio/examples/pull_bounds.rs`
- 布局示例：`crates/oink-display/examples/layout_conformance.rs`
