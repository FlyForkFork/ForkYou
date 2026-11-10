# oink

> 把多台 Mac/PC 变成一套键鼠、剪贴板、拖拽与音频的 P2P 软件 KVM。

| 项 | 值 |
|---|---|
| 上游 | [oinkvm/oink](https://github.com/oinkvm/oink) |
| 应用地址 | [GitHub Releases](https://github.com/oinkvm/oink/releases)（无独立官网） |
| License | GPL-3.0-only + additional terms |
| 语言 | Rust 主体（975 个 .rs / 44.7 万行）+ TypeScript（React 19 + Tauri 2） |
| 版本 | 0.3.5 |
| 分析深度 | L2 / deep |
| 分析 commit | `d8b29328678bfb50b5a9385a284f74572290c03b` |
| 更新时间 | 2026-11-10 |

## 这套文档怎么读

| 文档 | 回答什么问题 | 什么时候读 |
|---|---|---|
| [01 定位](01-positioning.md) | 它是什么、和 Deskflow/Input Leap/Universal Control 差在哪、健康度 | 第一次接触 |
| [02 架构](02-architecture.md) | 16 个 crate 怎么分、线程怎么划、一次输入怎么走完全程 | 想理解全局 |
| [03 代码走读](03-code-tour.md) | 先读哪 12 个文件、主流程函数级路径、加功能改哪 | 准备读代码 |
| [04 深挖：输入路由](04-deep-dive-routing.md) | 纯状态机、边缘抵抗、触控板接触、游戏模式、gap travel | 想偷状态机设计 |
| [04 深挖：网络与配对](04-deep-dive-network.md) | QUIC 单线程 runtime、500µs 预算、relay→direct cut-over、SPAKE2 | 想做实时网络 |
| [04 深挖：信任边界](04-deep-dive-trust.md) | 自动解锁、剪贴板去重与授权、本地凭据为什么不进协议 | 想做"跨设备特权操作" |
| [05 性能](05-performance.md) | 热路径预算、有界队列、常量表、可观测降级 | 做性能判断 |
| [06 分支](06-branches.md) | main 与 update-feed-state 的真实关系 | 想知道版本差异 |
| [07 贡献](07-contribute.md) | 工具链、CI 矩阵、系统权限、可上手入口 | 想参与 |
| [08 收获](08-takeaways.md) | 可迁移想法、面试卡、局限与不该抄的地方 | 做分享/面试 |
| [09 运维](09-ops.md) | 安装、端口、数据目录、日志、诊断包、升级回滚 | 要落地 |

## 快速开始

打开 [交互式 Guide](https://flyforkfork.github.io/ForkYou/01-systems/oink/guide.html) 获得 10 分钟图册版本。

```bash
npm ci
npm run -w apps/oink typecheck && npm run -w apps/oink test
cargo test -p oink-routing -p oink-protocol
```

## 一句话记住

Oink 把"跨设备"拆成三层可测边界：**纯状态机**决定输入去哪（不读时钟、不碰系统）、**单线程 QUIC owner** 承担全部网络状态、**线程所有权表**让实时路径永不等待普通路径——三者都用"调用方注入时间/快照/命令"换取可重放性。
