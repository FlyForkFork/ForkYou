# 04 深挖 B：网络层——单线程 QUIC + 明确预算

> 这是 Oink 第二个值得学的部分：它没有自己实现可靠传输，而是把 QUIC 当成“有连接、有流、有拥塞控制”的地基，只在上面做 link 管理、发现、配对、relay/cutover。

## 问题：局域网 P2P 连接不是“连上就完事”

Oink 要解决的不是普通 HTTP 请求，而是：

- 两台设备可能在不同子网、不同网卡、不同 NAT 后面。
- 需要自动发现，但不能依赖中心服务器。
- 配对要防中间人，又不能要求用户配证书。
- 连接可能先走 relay，再切直连；切换不能丢输入。
- 实时输入/音频对延迟敏感，不能排队等重传。
- 网络线程不能因为日志、锁、DNS 解析卡住。

## 设计总览

`crates/oink-network/src/link/mod.rs:1-19` 的模块文档是全文最好的入口：

> The network layer owns links and streams.
> What it does: keeps the links that are established, each in one of three states; inside, paths, the connection pool, end-to-end heartbeat, selection between simultaneous dials, one-hop relay, the relay-to-direct cut-over, and its private internal stream (N0) and pool-control stream (N1).
> What it does not do: discovery, address book, deciding whom to dial or when to retry, any knowledge of members, groups, pause, or the content of upper streams.
> All state lives on the thread `oink-network` with its private single-thread runtime. `LinkLayer` is a cloneable handle for ordinary threads: every method only sends a small fixed-size command and returns; results come back as notifications.
> Reliability, retransmission, flow and congestion control are QUIC's and kernel TCP's. There are no sequence numbers, acknowledgements, replay buffers or credits here.

这段话有四层信息：

1. **职责边界**：link 层只管“已建立的链路”，发现/地址簿/成员/暂停/上层内容都不管。
2. **并发模型**：所有状态在 `oink-network` 线程的私有单线程 runtime 上。
3. **句柄模型**：`LinkLayer` 可克隆，普通线程只发小命令，不阻塞。
4. **可靠性复用 QUIC**：不自己造 seq/ack/replay/credit。

## 关键常量：把预算写进代码

`crates/oink-network/src/link/mod.rs:53-90`：

| 常量 | 值 | 含义 |
|---|---:|---|
| `HEARTBEAT_INTERVAL` | 500ms | N0 端到端心跳 |
| `HEARTBEAT_TIMEOUT` | 2s | 无应答判定链路丢失 |
| `IDLE_TIMEOUT` | 10s | QUIC idle 超时 |
| `KEEP_ALIVE` | 5s | QUIC keep-alive |
| `MAX_DIALS` | 8 | 同时拨号/候选握手上限 |
| `DIAL_BUDGET` | 3s | 每个候选的完整 TLS 预算 |
| `ADDRESS_QUERY_BUDGET` | 5s | 手动地址搜索（含 TLS/选择/C0 greeting） |
| `MAX_INBOUND_PENDING` | 32 | 已接受但还在 TLS/选择的入站连接 |
| `RELAY_TIMEOUT` | 3s | relay 请求/预留超时 |
| `CUTOVER_TIMEOUT` | 500ms | relay→direct 切换提交预算 |
| `DIRECT_RETRY` | 15/15/30/60s | relayed link 的直连重试节奏 |
| `ROUND_BUDGET` | 500µs | 网络线程一轮循环总预算 |
| `OWN_BUDGET` | 100µs | 自己的 N0/心跳/cutover/选择/relay |
| `INTERACTIVE_BUDGET` | 250µs | 交互流 + datagram |
| `NORMAL_BUDGET` | 150µs | 普通流/命令/新连接 |

这些常量不是“随便调参”，而是**产品级 SLA 的代码化**：

- 2s 心跳超时比 10s QUIC idle 更早判定，避免用户等 10 秒才发现断线。
- 500ms 心跳频率足够快，又不会把局域网打满。
- 3s 拨号预算防止一个坏候选拖死整轮。
- 500µs 总预算 + 分段预算，保证网络线程不会被某一类流饿死。

## 调度：一轮循环怎么花 500µs

`link/mod.rs:85-90` 的注释说明顺序：

1. 两次 yield 给 QUIC drivers。
2. 自己的 N0/心跳/cutover/选择/relay（`OWN_BUDGET=100µs`）。
3. 交互流 + 所有 datagram（`INTERACTIVE_BUDGET=250µs`）。
4. 普通流/命令/新连接（`NORMAL_BUDGET=150µs`）。

未用完的时间结转到下一轮；但“当前手里这条消息处理完就停”。这是一个**合作式调度 + 预算隔离**的典型实现：没有抢占，但通过分段预算保证公平。

## 配对：SPAKE2 + 6 位码

`crates/oink-network/src/group_pake.rs:1-2`：

> SPAKE2 binds the UI roles, exact greeting frames, full tagged identities and each submitted attempt. Confirmation keys never become a group secret.

实现细节：

- 6 位数字码：`group_pake.rs:29` 检查 `code.len() == 6` 且全 ASCII 数字；`32` 用 `Zeroizing` 包装，避免内存残留。
- `Transcript::new(context, attempt, hello, info)` 绑定：UI 角色、精确 greeting 帧、完整带标签身份、每次尝试（`group_pake.rs:53-81`）。
- 用 HKDF-SHA256 派生确认密钥，再用 HMAC-SHA256 分别算 initiator/responder 的 confirmation（`group_pake.rs:81-97`、`138-146`）。
- 测试覆盖“错误码/错误 transcript 不确认”（`group_pake.rs:260-267`）和“确认绑定角色、码、attempt”（`246-256`）。

**为什么值得学**：很多配对实现只对“码”做哈希，不绑定角色/attempt/transcript，容易受重放或角色混淆攻击。Oink 把“这次配对的完整上下文”打进 transcript，是一个正确的安全习惯。

## 发现与地址

- 服务名：`_oink._udp`（`crates/oink-protocol/src/v1/mod.rs:25`）。
- ALPN：`oink-wire/1`（QUIC）、`oink-low/1`（低层/TCP 回退）（`v1/mod.rs:23-24`）。
- 发现实现：`crates/oink-network/src/discovery/{builtin,dnssd,advert}.rs`。
- 地址查询预算 5s（`link/mod.rs:67`）。

Oink 不依赖中心服务器；局域网内通过 mDNS/UDP 广播发现，必要时用手动地址。这个选择适合“家里/办公室同一 LAN”的主场景，但跨公网就需要 relay/手动地址。

## Relay 与 cutover

当直连失败时，link 可以走一跳 relay；同时后台按 `DIRECT_RETRY` 重试直连。直连成功后执行 cutover：

- `CUTOVER_TIMEOUT=500ms`：从“开始切换”到“提交”的预算；超时则丢链路。
- `RELAY_TIMEOUT=3s`：relay 请求/预留超时。
- `MAX_DIALS=8`：并发候选上限，避免一个 peer 把握手槽占满。

这套设计的工程价值：**把“连接”当成一个会退化的状态机**，而不是“连不上就报错”。用户感知是“先能用（relay），再变快（direct）”。

## 为什么用单线程 runtime

`link/mod.rs:9-13` 明确：所有状态在私有单线程 runtime 上，`LinkLayer` 只是句柄。

好处：

- 没有锁竞争，延迟可预测。
- 不需要 `Arc<Mutex<...>>` 包住整个 link 表。
- 调试时状态只在一个线程上变化，时序清晰。

代价：

- 单线程可能成为瓶颈；所以有 500µs 预算和分段调度。
- 所有外部调用必须异步化/命令化，API 设计更繁琐。
- 一旦某个 handler 阻塞，整个网络线程卡住；代码里必须严格禁止同步 I/O。

## 与自研可靠传输的对比

| 方案 | 优点 | 缺点 |
|---|---|---|
| 自己实现 seq/ack/replay/credit | 完全可控、可针对场景优化 | 极易出 bug；拥塞控制难；测试成本高 |
| 直接用 QUIC（Oink 的选择） | 成熟拥塞控制、流控、加密、连接迁移 | 依赖 quinn/rustls；协议行为受限于 QUIC |
| TCP | 简单、系统成熟 | 队头阻塞；多流场景不灵活 |

Oink 的选择是“把难题交给 QUIC，把差异化留给 link 管理/路由/配对”。这是很务实的架构决策。

## 可迁移的经验

1. **实时子系统一个 owner 线程**：网络状态不要跨线程共享。
2. **预算常量代码化**：心跳、超时、重试、每轮调度都写成 `const`，评审时可讨论。
3. **可靠性分层**：QUIC 负责可靠/流控，业务只决定“这条消息要不要可靠”。
4. **配对 transcript 绑定上下文**：角色、attempt、hello、身份全绑。
5. **连接退化设计**：relay 先可用，direct 再优化，cutover 有超时。

## 关键证据

- 网络层职责/线程模型：`crates/oink-network/src/link/mod.rs:1-19`
- 预算常量：`crates/oink-network/src/link/mod.rs:53-90`
- 配对：`crates/oink-network/src/group_pake.rs:1-2`、`29`、`53-97`、`138-146`、`246-267`
- 协议常量：`crates/oink-protocol/src/v1/mod.rs:21-26`
- 发现：`crates/oink-network/src/discovery/`
- relay/cutover：`crates/oink-network/src/link/core.rs`、`link/core/relay.rs`
- 调度预算：`crates/oink-network/src/link/runtime.rs:277-305`
