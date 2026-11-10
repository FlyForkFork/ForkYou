# 01 定位：Oink 是谁的替代品

## 这篇回答什么问题

Oink 到底是什么、谁在什么场景用它、和现有的软件 KVM 差在哪、这个项目现在值不值得花时间读。

## 一句话是什么

Oink 是一个 **peer-to-peer 软件 KVM**：把同一局域网里的多台 Mac / Windows 拼成"一套键鼠 + 一块剪贴板 + 一条音频链路 + 一个拖拽平面"。键盘鼠标在哪台机器上，哪台就是当前的输入源——没有 server/client 角色。

代码规模（`git ls-files`，2026-11-10 本地 clone）：4020 个文件；Rust `.rs` 975 个、447216 行；`apps/oink/src` 下 TS/TSX 227 个（其中 106 个是测试）。最大的 5 个 crate 是 `oink-agent` 15.8 万行、`oink-clipboard` 8.1 万行、`oink-input` 4.3 万行、`oink-routing` 3.6 万行、`oink-network` 3.0 万行。

## 谁在什么场景下用它

- 一个人有两台以上机器（Mac + Windows 双持是最常见组合），桌面上只有一套物理键鼠。
- 需要的不只是"键鼠共享"：还想跨机器粘贴、把文件从一台拖到另一台、把 Windows 的音频放到 Mac 的耳机上。
- 不想在机器之间指定"主控机"——因为笔记本会合盖、会被带走，固定 server 角色在真实使用里总有一半时间是错的。

官方 README 把这三点写成产品主张（`README.md:12`：peer-to-peer、任意设备的键鼠可控制任意设备、音频/剪贴板/拖拽/自动发现/默认加密）。这句话本身是宣传，但下面每条在代码里都能找到对应实现，02/04 会逐个落地。

## 它要解决的痛点

没有它之前，人们有三条路，每条都有明确的坏处：

| 做法 | 坏处 |
|---|---|
| 物理 KVM 切换器 | 只切显示器和一套 USB，剪贴板/文件/音频完全不过去；4K/高刷线材成本高 |
| Synergy / Deskflow / Input Leap 一类 client-server KVM | 必须指定一台当 server；server 睡眠或断网，整组失效；协议是 2000 年代设计，没有音频、没有现代剪贴板语义 |
| Apple Universal Control | 只在苹果生态内；不跨 Windows；不可编程、不可观测 |

Oink 的赌注是：**把角色从"配置"变成"运行时状态"**。谁是输入源由"指针现在在谁的屏幕上"决定，而不是由一份配置文件决定。这个决定贯穿整个架构——`Router` 的每一次焦点移交（`DecisionKind::Handoff`）都是在运行时改角色，而不是切换连接模式。

## 竞品对比

数据取自 GitHub API 与仓库文件，日期 2026-11-10。

| 方案 | 定位 | 核心差异 | License | 成熟度 |
|---|---|---|---|---|
| **Oink** | P2P 多机共享（键鼠+剪贴板+拖拽+音频） | 无固定 server；自研 QUIC 协议（`oink-protocol` v1，ALPN `oink-wire/1`）；音频走独立 M1 流 | GPL-3.0-only + additional terms | 新项目：2026-10-19 创建，1156 stars / 98 forks / 13 open issues，最新 0.3.5（2026-11-10） |
| [Deskflow](https://github.com/deskflow/deskflow) | 经典 client-server 键鼠共享 | 从 Synergy 分叉而来；TCP + 自定义协议；生态大、文档多 | GPL-2.0 | 成熟：30860 stars / 5108 forks / 256 open issues，master 活跃 |
| [Input Leap](https://github.com/input-leap/input-leap) | Synergy 的开源延续 | 同 client-server 模型；跨 Linux 支持最好 | NOASSERTION（GPL-2.0 衍生） | **已归档**：8311 stars / 814 open issues，2025-12 后无推送 |
| Apple Universal Control | 苹果生态内的键鼠/剪贴板共享 | 系统级集成、体验最好；不出苹果生态 | 闭源 | 随 macOS 发布 |
| Microsoft Mouse Without Borders | Windows 内部的键鼠共享 | 免费、装机即用；基本只覆盖 Windows 之间 | 闭源 | 随 PowerToys 发布 |

差异的实质不在功能列表，而在**失败模型**：client-server 方案的经典故障是"server 挂了，整组失联"；Oink 的经典故障是"某台机器掉线，其余设备仍可两两直连"——因为每条链路是独立的 QUIC 连接（`crates/oink-network/src/link/mod.rs:1-21` 明确写"三态链路、连接池、端到端心跳、并发拨号、一跳 relay"，且"不做发现/地址簿/成员"）。

**为什么是现在**（推断，依据是代码里的技术选择而非作者自述）：

1. QUIC 在 Rust 生态成熟（quinn + rustls），使"自带多路复用 + 自带加密 + 自带拥塞控制"的实时数据平面可以一个人写完——`oink-network` 里没有任何 seq/ack/重传/流控/credit 的自研代码，全部交给 QUIC 与内核 TCP。
2. Tauri 2 让"Rust 后端 + Web 前端"的桌面 App 不必自带一个 Chromium；Oink 的 UI 只有 227 个 TS/TSX 文件，却要做多设备卡片、布局编排、权限引导。
3. 一个人 + AI 辅助能把 44 万行 Rust 维护起来，前提是**边界被设计成可测的**——这是 0.3.x 三个版本迭代速度（3 周 13 个 tag）的真正原因，也是这套文档最想讲的部分。

## 项目健康度

| 指标 | 值 | 来源 |
|---|---|---|
| Stars / Forks / Open issues | 1156 / 98 / 13 | GitHub API，2026-11-10 |
| 创建时间 / 最近推送 | 2026-10-19 / 2026-11-10T13:14:44Z | 同上 |
| 贡献者 | 1（`hachiwii`，69 contributions） | GitHub contributors API |
| 发布节奏 | 13 个 tag（v0.1.0 → v0.3.4）三周内；0.3.5 刚发布 | `git tag` |
| 平台 | macOS 14.2+（arm64 为主，x64 0.3.4 起支持但"untested"）、Windows 10 1809+ / 11 x64 | `README.md:20-21` |
| License | GPL-3.0-only + additional terms（禁止用 Oink 名义推广衍生品） | `README.md:50` |
| 测试密度 | `crates/` 下 3926 个 `#[test]`；前端 106 个测试文件 | 本地 grep |
| 外部贡献 | **不接受无上下文 PR**，全部走 Issues | `README.md:33` |

单贡献者 + 三周 13 个 tag + 1156 stars，这三个数放在一起说明：项目处在"作者全力冲刺、社区围观"的阶段。风险是 bus factor = 1；好处是架构决策没有委员会痕迹，每个取舍都能在代码注释里读到理由（这套文档大量引用这些注释，因为它们比大多数项目的设计文档更密）。

## 应用地址 / 入口

- 安装包：[GitHub Releases](https://github.com/oinkvm/oink/releases)（macOS dmg/zip arm64 与 x64、Windows msi）
- 无独立官网；更新 feed 域名是 `https://updates.oink.hachiwii.com`（`crates/oink-update/src/feed.rs:44`）
- 文档入口：[README](https://github.com/oinkvm/oink#readme)（英/中/日/韩四语）、[PRIVACY.md](https://github.com/oinkvm/oink/blob/d8b29328678bfb50b5a9385a284f74572290c03b/PRIVACY.md)
- Issue 入口：<https://github.com/oinkvm/oink/issues>（要求附设备环境、诊断数据、复现步骤、AI 辅助调查结论）

## 一句话结论

值得学，而且值得**按层学**：想要状态机设计读 `oink-routing`（04-routing），想要实时网络读 `oink-network`（04-network），想要"跨设备特权操作怎么不泄密"读自动解锁与剪贴板授权（04-trust）。不适合学"如何做产品运营"——这是一个人的项目，工程密度远高于社区运营密度。

## 一句话记住

Oink 的定位不是"又一个 Synergy"，而是把软件 KVM 从**配置驱动的 client-server** 改成**状态驱动的 P2P 数据平面**——这个改动让"谁是主控"从静态配置变成运行时决策，代价是所有边界都必须可重放、可测试。
