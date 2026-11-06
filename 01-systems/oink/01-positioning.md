# 01 定位：Oink 是什么，为什么值得看

> 分析对象：`oinkvm/oink`，分析 commit `546f65b2135e7a1491d2d743f0a1e072a74df36f`（`main`）
> 证据基准：本地 clone（工作区根目录 `oink/`，`main` 浅克隆）

## 一句话定位

Oink 是一套**去中心化的软件 KVM**：把同一局域网内的 Windows 与 macOS 电脑组成一个点对点共享网络，让任意一台机器的键盘、鼠标、触控板可以控制其他机器，同时共享剪贴板、拖拽文件和音频。它不是“一台主控 + 多台被控”的 Synergy/Deskflow 模式，而是每台机器都能发起控制的 P2P 模式。

项目名是递归缩写：**Oink Is Not only a KVM**（`README.md:8`）。

## 它解决的具体痛点

传统软件 KVM 通常要求指定一台“Server”，其他机器作为“Client”连接。这个模型有三个现实问题：

1. **主控机是单点**：Server 关机、休眠或网络切换，整套键鼠共享就断了。
2. **角色切换不自然**：用户从笔记本切到台式机，往往要改配置或重新连接。
3. **能力割裂**：键鼠共享、剪贴板、文件拖拽、音频通常是四套独立工具，体验和权限模型不一致。

Oink 的做法是把“设备”做成对等节点：每台机器都运行同一个 agent，谁产生输入，谁就成为当前输入源；路由、剪贴板、拖拽、音频都走同一条加密链路。`README.md:12` 明确写了 “peer-to-peer sharing network” 和 “keyboard and mouse ... of any device to control any nearby device”。

## 目标用户与适用场景

- **多机开发者**：Mac + Windows 双机，或公司/家里多台电脑，希望一套键鼠直接跨屏。
- **桌面重度用户**：需要跨机复制粘贴、拖拽文件、共享音箱/耳机。
- **系统/网络学习者**：想看一个真实项目如何把 QUIC、P2P、输入注入、剪贴板、音频放进同一个桌面应用。
- **架构面试准备**：项目里有大量“纯状态机 + 实时线程 + 明确预算”的工程决策，适合作为架构案例。

不适合的场景：

- 需要 Linux 桌面支持：当前只支持 macOS 14.2+（Apple silicon）与 Windows 10 22H2+/11（`README.md:20-21`）。
- 需要与 Synergy/Deskflow/Barrier 协议互通：Oink 明确使用自研协议，不兼容（`README.md:37-38`）。
- 需要成熟商业支持或长期稳定 API：项目 2026-10 才创建，版本 0.3.3，仍很年轻。

## 与现有方案的对比

| 方案 | 架构 | 平台 | 强项 | 局限 |
|---|---|---|---|---|
| **Oink** | P2P，每台都可当输入源 | macOS 14.2+ arm64；Windows 10 22H2+/11 x64 | 键鼠 + 剪贴板 + 拖拽 + 音频统一；无主从；默认加密 | 新项目；仅两平台；自研协议不兼容 |
| Synergy / Deskflow | Client–Server | Windows/macOS/Linux | 成熟、跨平台 | 需指定 Server；体验依赖网络 |
| Barrier | Client–Server | Windows/macOS/Linux | 开源、老牌 | 维护活跃度与体验参差 |
| Mouse Without Borders | Windows 专用 | Windows | 微软生态内轻量 | 不支持 macOS |
| Apple Universal Control | Apple 生态 | Apple 设备 | 原生体验最好 | 仅 Apple，不可跨 Windows |

> 竞品信息按公开资料整理，具体版本能力“待查实”；本表只用于定位，不作为性能结论。

## 差异化亮点

1. **真正的 P2P 输入路由**：没有固定 Server。`README.md:40-41` 的 FAQ 明确回答“不需要指定控制端”。
2. **能力面比传统 KVM 宽**：键鼠、剪贴板、拖拽、音频都在同一个 agent 内，共享同一条加密链路（`README.md:12`、`46-47`）。
3. **协议从零设计**：`crates/oink-protocol/src/v1/mod.rs:21-26` 定义 `MAJOR=1`、`MINOR=0`、`oink-wire/1`、`oink-low/1`、`_oink._udp`，并带 `SPEC_REVISION`，说明团队把协议当成长期兼容契约，而不是随手 JSON。
4. **安全默认开启**：README 写 “all traffic is encrypted by default”；配对使用 SPAKE2 + 6 位码（`crates/oink-network/src/group_pake.rs:1-2`、`29`）。

## 项目健康度与风险

| 指标 | 事实 | 判断 |
|---|---|---|
| 创建时间 | 2026-10-19 | 非常新，API/协议仍可能变 |
| 最近推送 | 2026-11-06 | 活跃 |
| Stars / Forks | 约 456 / 39 | 早期关注度不错 |
| Open Issues | 8 | 问题量不大，但样本小 |
| 版本 | 0.3.3 | 未到 1.0 |
| License | GPL-3.0-only + additional terms | 商用/分发需注意附加条款 |
| 贡献政策 | 不接受无上下文 PR，优先 Issues（`README.md:31-33`） | 参与门槛偏“先沟通” |

**反证**：项目很新、作者明确说“没有时间 review 代码”，这意味着“读完就能提 PR”的预期不现实；更适合学习、写 issue、做平台实测和文档贡献。

## 关键证据

- 定位与 P2P：`README.md:8`、`12`、`40-41`
- 平台限制：`README.md:20-21`
- 竞品不兼容：`README.md:37-38`
- 贡献政策：`README.md:31-33`
- 许可证：`README.md:49-54`
- 协议常量：`crates/oink-protocol/src/v1/mod.rs:21-26`
- 配对：`crates/oink-network/src/group_pake.rs:1-2`、`29`

## 待查实

- README 未给出公开主页；应用下载地址以 GitHub Releases 为准。
- 竞品对比表中的具体功能/版本能力未逐一实测。
- 真实网络环境下的延迟、吞吐、CPU 占用没有官方基准，见 `05-performance.md`。
