# 05 性能：延迟预算怎么落到代码里

## 这篇回答什么问题

软件 KVM 的性能指标不是"每秒处理多少事件"，而是"最坏情况下的延迟是多少"。这篇拆 Oink 把预算写进代码的几个位置，以及它的瓶颈在哪里。

## 性能敏感路径

按对延迟的敏感度排序：

1. **输入捕获 → 路由 → 发送**（input 线程，实时）。指针移动在 125Hz 或更高频率下产生事件，每个事件都要在亚毫秒级完成决策。
2. **网络轮询 → 解包 → 注入**（network 线程 + injection 线程，实时）。一个 500µs 轮次里要服务所有链路。
3. **音频采集 → 编码 → 发送 / 接收 → 解码 → 混音**（audio 线程，实时）。10ms 一帧，队列满就丢。
4. **剪贴板读取**（ordinary pool）。可能读几十 MB 的图片，绝不能碰输入线程。
5. **UI 与配置**（main 线程 / ordinary pool）。慢一点无所谓。

## 复杂度

- **路由**：`Router::on_local_event` 对单个输入事件的处理是 O(1)——状态机分支，没有遍历。例外是布局查找和轨迹点，都是小数组（屏幕数上限 `SCREENS 256`，实际 2–4）。
- **布局转换**：`LayoutQuery::step` 是纯计算，每帧最多一次。
- **边缘阻尼**：`crates/oink-routing/src/damping.rs:145-146` 用 10ms 的 bin（`BIN_US=10_000`）和 `DT=0.01` 做积分，所以阻尼计算是常数时间，不随移动距离增长。
- **网络**：每轮 O(active streams + pending effects)。连接池最多 8 个并发拨号（`MAX_DIALS`）。
- **音频**：每帧 O(480 samples × 2 channels)，重采样最多 `FRAME_SIZE*32` 个样本的缓冲。
- **剪贴板**：摘要计算 O(bytes)，但只在前台读取，且有 16MiB/128MiB 上限。

仓库里**没有 `benches/` 目录，也没有 criterion 依赖**（`grep -rn criterion --include=Cargo.toml` 为空）。所以下面给的是"代码里的常量 + 可执行的测量命令"，不是 benchmark 数字。

## 关键常量

| 参数 | 值 | 位置 |
|---|---|---|
| 网络轮总预算 | 500µs | `crates/oink-network/src/link/mod.rs:87` |
| 第一段（自己的活） | 100µs | 同上 `:88` |
| 第二段（交互流） | 250µs | 同上 `:89` |
| 第三段（普通流） | 150µs | 同上 `:90` |
| 网络线程 realtime 预算 | 500µs（Elevated 1ms） | `crates/oink-foundation/src/realtime.rs:46` |
| input/inject 线程预算 | 250µs（Elevated 1ms） | 同上 |
| 调度读回间隔 | 5s | `crates/oink-foundation/src/realtime.rs:11` |
| 心跳间隔 / 超时 | 500ms / 2s | `crates/oink-network/src/link/mod.rs:53-55` |
| 音频采样率 / 帧 | 48kHz / 480 samples（10ms） | `crates/oink-audio/src/dsp.rs:8-12` |
| 音频目标队列 / 最大队列 | 3 帧 / 12 帧 | `crates/oink-audio/src/dsp.rs:15-16` |
| PLC 上限 | 6 帧 | `crates/oink-audio/src/dsp.rs:17` |
| 重采样扩展上限 | -0.2%（2000 ppm） | `crates/oink-audio/src/dsp.rs:22` |
| 重采样压缩上限 | 5000 ppm | `crates/oink-audio/src/dsp.rs:23` |
| 静音门限 | 峰值 0.001（-60dBFS，20ms） | `crates/oink-audio/src/dsp.rs:26` |
| 最大抖动 | 250ms | `crates/oink-audio/src/dsp.rs:28` |
| 指针移动默认频率 | 125Hz（可调 Unlimited） | `crates/oink-agent/src/main.rs:96-99` |

## 优化手法

### 1. 线程所有权，而不是锁

`crates/oink-agent/src/threads/mod.rs:1-17` 的规则是：实时线程之间只通过"每流每端一个队列、整块替换的只读快照、小定长命令"通信。**没有共享锁、没有文件 I/O、没有日志格式化**。

这条规则对性能的贡献比任何微优化都大：锁竞争的方差是不可预测的，而队列的方差是可测量的。

### 2. 分段时间预算 + 未用完结转

`[OWN 100µs, INTERACTIVE 250µs, NORMAL 150µs]` 不是三个独立配额，而是三个**截止点**：第一段提前做完，时间自动给第二段。这比固定配额更适应负载——空闲时全部给交互流，繁忙时至少保证自己的心跳和探测。

### 3. 实时调度"设置后读回"

`realtime.rs:1-8` 的文档：

> Detection only: after setting, the effective policy is read back and recorded; later read-backs that differ count as demoted. Nothing restores or tunes automatically.

这是一个**可观测性优化**而不是性能优化：它不提升性能，但让"性能为什么变差"变成可查的数字（`demoted` 计数）。很多项目在 QoS 被系统降级后毫无察觉。

### 4. 音频：目标 3 帧 + 连续重采样

`dsp.rs:15` 的 `TARGET_FRAMES=3` 意味着目标延迟约 30ms（3 × 10ms）。`dsp.rs:1591` 的注释说明了渐变策略：

- 需要增加 reserve 时，用**连续重采样**慢慢加，最多 -0.2% 的扩展速率；
- 需要减少时，按 profile 有压缩上限；
- 构建 20ms 的 reserve 至少用 10 秒，纯速率排空至少 4–10 秒。

也就是说它**不会**为了追赶队列而瞬间改变播放速率——瞬间变速会被听成"音调跳变"。这正是 0.3.4 release notes 里"静音段后音高跳变"修复的方向。

### 5. datagram 零等待

`realtime_datagram.rs` 的 lane claim 用 CAS，失败就返回"没活干"。没有自旋、没有条件变量、没有超时等待。实时路径上"等"是最贵的操作。

### 6. 快照整块替换

`oink_foundation::snapshot::Snapshot` 的语义是"读的人拿到一个 Arc，写的人构造新的一份再原子替换"。读侧永远不阻塞，代价是写侧要复制。对于"每秒变几次、每秒读几千次"的配置数据，这个取舍明显划算。

## 怎么自己测

```bash
# 1. 构建 release（LTO thin + codegen-units=1，Cargo.toml profile.release）
cargo build --release --locked

# 2. 跑全部测试（含 release 模式的 lib 测试，build-support/ci.py 也这么跑）
cargo test --locked
cargo test --locked --release --lib

# 3. 慢测试（含 native 更新测试、packaging 测试）
python build-support/ci.py --slow

# 4. 看实时调度是否被降级：日志里搜 demoted / over_budget
#    对应 realtime.rs 的 read_back 比对与 runtime.rs 的 over_budget 计数
```

仓库没有内置的延迟 benchmark，所以**端到端延迟只能实测**：两台机器配对后，用高速摄像机拍"本地移动 → 远端屏幕移动"，或者用 `MotionFrequency unlimited` 把事件率拉满观察是否掉帧。这是 `待查实` 的部分——本次分析没有做真机测量。

## 瓶颈与反例

**瓶颈 1：单网络线程。** 500µs/轮 × 所有链路。设备多、流多时，每轮服务不完就会累积。代码用 `late_rounds` / `late_max` / `over_budget` 暴露这个问题，但不会自动扩容。

**瓶颈 2：音频队列 12 帧。** 240ms 的硬上限。超过就丢帧（PLC 补 6 帧）。在 Wi-Fi 抖动大的环境里，这会表现为"声音断续"，而不是"延迟增大"——这是刻意的：音频宁可断，不可延迟累积。

**瓶颈 3：剪贴板大对象。** 256MiB 的 representation 上限意味着一次粘贴可能读很久。它在 ordinary pool 上，不影响输入，但会让"粘贴"这个动作本身变慢。

**反例：不要在这类项目里做"事件批处理"。** 批处理能提高吞吐，但会把 N 个事件的延迟合并成"最慢那个"的延迟。输入场景里吞吐从来不是瓶颈。

**反例：不要用自适应拥塞控制。** `qos.rs` 用固定窗口是有意的——局域网带宽充足，自适应算法在低延迟场景下反而引入排队波动。

## 一句话记住

Oink 的性能观是"**把方差关进笼子**"：线程所有权消除锁竞争、分段预算消除饿死、固定拥塞窗口消除排队波动、音频渐变消除音调跳变——它优化的不是平均值，是最坏值。
