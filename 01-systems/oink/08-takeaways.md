# 08 收获：10 个可以带走的架构想法

> 这一篇是“面试/分享/吹B”专用。每个点都给出：问题 → Oink 的做法 → 为什么好 → 你怎么用。

## 1. 纯决策核心 + 命令式外壳

- **问题**：输入路由充满 I/O、时钟、平台 API，逻辑和副作用搅在一起，无法测试。
- **Oink**：`Router` 是纯状态机，输入是数据，输出是 `Output` 队列；`drain_outputs` 由外部执行（`crates/oink-routing/src/router.rs:1-5`）。
- **为什么好**：可以用虚拟时钟和事件序列复现跨屏/按键/触控板 bug；测试不需要两台真机。
- **怎么用**：任何“状态机 + 外部世界”的模块，先定义 `Input`/`Output`/`State`，把 I/O 推到边界。

## 2. 可靠性是消息属性，不是全局模式

- **问题**：所有消息都可靠 → 游戏相对运动排队、延迟爆炸；所有消息都不可靠 → 焦点/按键乱序。
- **Oink**：`Delivery::Reliable`（有序）vs `Delivery::Datagram`（低延迟可丢）（`router.rs:94-102`）。
- **为什么好**：同一条连接上按语义分流，兼顾正确性和实时性。
- **怎么用**：别设计一个“万能可靠通道”；让业务标注消息的 delivery class。

## 3. 每个实时子系统一个 owner 线程

- **问题**：多线程共享状态 + 锁 → 抖动、死锁、不可预测。
- **Oink**：input/injection/network/audio 各自 realtime owner；线程间只有队列、快照、固定命令（`threads/mod.rs:3-15`）。
- **为什么好**：没有跨线程锁竞争；状态只在一个线程变，调试简单。
- **怎么用**：把“实时”当成一种架构约束，不是加个线程池就完事。

## 4. 预算写进代码

- **问题**：网络线程被大文件/普通流饿死，输入卡顿。
- **Oink**：`ROUND_BUDGET=500µs`、`OWN=100µs`、`INTERACTIVE=250µs`、`NORMAL=150µs`（`link/mod.rs:85-90`）。
- **为什么好**：调度公平性可评审、可回归；不是靠“感觉”。
- **怎么用**：给每个实时循环定义总预算 + 分段预算，超时要有降级策略。

## 5. 连接是会退化的状态机

- **问题**：P2P 直连失败就报错，用户体验差。
- **Oink**：relay 先可用，后台按 15/15/30/60s 重试直连，成功后 500ms cutover（`link/mod.rs:76-83`）。
- **为什么好**：用户先能用，再变快；失败可回滚。
- **怎么用**：把“连接”设计成 `direct → relay → direct` 的状态机，而不是布尔值。

## 6. 配对 transcript 绑定完整上下文

- **问题**：6 位码配对容易被重放/角色混淆。
- **Oink**：SPAKE2 + transcript 绑定 UI 角色、greeting 帧、身份、attempt；HKDF/HMAC 确认（`group_pake.rs:1-2`、`53-97`）。
- **为什么好**：即使码泄露，攻击者也不能把确认消息重放到另一个角色/尝试。
- **怎么用**：任何配对协议，确认消息必须绑定“角色 + 会话 + 尝试 + 身份”。

## 7. 懒加载 + 授权，而不是复制即全量

- **问题**：剪贴板/拖拽大内容，复制时全量传输会卡顿、浪费带宽。
- **Oink**：`Provider` 先发布 representation 描述，接收方按需打开；grant 控制作用域/生命周期（`content.rs:101`、`237`）。
- **为什么好**：复制瞬间不阻塞；只有真正粘贴/拖拽才付传输成本。
- **怎么用**：文件/图片/大对象用“描述 + 按需读取 + 授权”模型。

## 8. 有界队列 + PLC，而不是无限缓冲

- **问题**：音频网络抖动，无限缓冲会延迟越来越大；直接丢会爆音。
- **Oink**：目标 3 帧、最大 12 帧、最大 PLC 6 帧；960 字节包上限（`dsp.rs:8-17`）。
- **为什么好**：延迟有上界；丢包用 PLC 掩盖；内存可控。
- **怎么用**：实时媒体一律有界队列；溢出策略要明确（丢旧/PLC/淡出）。

## 9. 平台差异放在边缘

- **问题**：macOS/Windows 的输入、菜单、服务模型完全不同，核心逻辑被平台 `if` 淹没。
- **Oink**：核心 routing/protocol/network 平台无关；平台代码在 `oink-input/src/{macos,windows}`、`oink-winsvc`、`apps/oink/src-tauri`。
- **为什么好**：核心可测试；新增平台只加 adapter。
- **怎么用**：先定义平台无关的领域接口，再写平台实现；不要反过来。

## 10. 安全默认开启，且可验证

- **问题**：局域网 KVM 传输键鼠/剪贴板，明文很危险。
- **Oink**：QUIC + rustls 默认加密；配对 SPAKE2；Windows 服务固定启动 recipe（`backend_launch.rs:1`、`20`）。
- **为什么好**：用户不需要额外配置；攻击面可控。
- **怎么用**：安全不是“可选开关”，默认就要加密 + 最小权限。

---

## 面试问答卡（可直接背）

### Q1：Oink 和 Synergy/Deskflow 最大区别？
A：Oink 是 P2P，每台设备都能当输入源，不需要指定 Server；Synergy/Deskflow 是 client-server。Oink 还用自研 QUIC 协议，不兼容它们（`README.md:37-41`）。

### Q2：为什么 router 要做成纯状态机？
A：输入路由的边界条件太多（按住键跨屏、触控板多指、游戏模式、掉线），纯状态机可用虚拟时钟/事件序列测试，不需要真机；副作用由 `drain_outputs` 在外部执行（`router.rs:1-5`）。

### Q3：Reliable 和 Datagram 怎么选？
A：键盘/按钮/焦点移交必须可靠有序；游戏相对运动用 datagram，迟到就无意义，宁可丢（`router.rs:94-102`）。

### Q4：网络线程为什么单线程？
A：所有 link/stream 状态在一个私有 current-thread runtime，避免锁竞争、延迟可预测；普通线程通过 `LinkLayer` 句柄发小命令（`link/mod.rs:9-13`）。

### Q5：500µs 预算怎么花？
A：一轮 500µs：100µs 自己的心跳/cutover/relay，250µs 交互流+datagram，150µs 普通流/命令/新连接；未用完结转（`link/mod.rs:85-90`）。

### Q6：配对怎么防中间人？
A：SPAKE2 + 6 位码；transcript 绑定角色/greeting/身份/attempt；HKDF 派生确认密钥，HMAC 校验（`group_pake.rs`）。

### Q7：剪贴板为什么懒加载？
A：复制时只发布 representation 描述，粘贴/拖拽时才按需读取；grant 控制授权和生命周期，避免大内容阻塞输入线程（`content.rs:101`、`237`）。

### Q8：音频队列怎么设计？
A：48kHz 立体声，Opus/PCM 可选；目标 3 帧、最大 12 帧、PLC 6 帧、960 字节包上限；溢出用丢帧/PLC/淡出，不无限缓冲（`dsp.rs:8-17`）。

---

## “吹B”一句话

- “Oink 把输入路由做成了纯状态机，跨屏/按键/触控板都能用虚拟时钟测，不靠两台真机。”
- “它的网络层不自己造可靠传输，QUIC 管可靠/流控，业务只标 Reliable/Datagram。”
- “每个实时子系统一个 owner 线程，线程间只有队列/快照/固定命令，没有共享锁。”
- “连接不是布尔值，是 direct→relay→direct 的状态机，500ms cutover。”
- “配对不是对 6 位码做哈希，而是把角色、greeting、身份、attempt 全绑进 transcript。”

## 局限与反例

- **自研协议 = 生态孤岛**：不能和 Synergy/Deskflow 互通；学习价值高，但产品采用需谨慎。
- **复杂度高**：15 个 crate、309 个 agent 源文件；小团队维护成本不低。
- **平台少**：只有 macOS/Windows；Linux 用户无法用。
- **项目新**：0.3.3，协议/API 可能变；不要把它当稳定平台。
- **没有公开 benchmark**：性能结论要自己测，别把设计意图当实测数据。

## 关键证据

- Router：`crates/oink-routing/src/router.rs:1-5`、`94-102`
- 线程：`crates/oink-agent/src/threads/mod.rs:3-15`
- 网络预算：`crates/oink-network/src/link/mod.rs:53-90`
- 配对：`crates/oink-network/src/group_pake.rs:1-2`、`53-97`
- 剪贴板：`crates/oink-clipboard/src/content.rs:101`、`237`
- 音频：`crates/oink-audio/src/dsp.rs:8-17`
- 平台：`README.md:20-21`、`37-41`
