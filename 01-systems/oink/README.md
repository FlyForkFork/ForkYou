# oink

> 把多台 Mac/PC 变成一套键鼠、剪贴板、拖拽和音频的 P2P 软件 KVM。

| 项 | 值 |
|---|---|
| 上游 | [oinkvm/oink](https://github.com/oinkvm/oink) |
| 应用地址 | [GitHub Releases](https://github.com/oinkvm/oink/releases)（无独立官网） |
| License | GPL-3.0-only + additional terms |
| 语言 | Rust + TypeScript（Tauri/React） |
| 分析深度 | L2 |
| 分析 commit | `546f65b2135e7a1491d2d743f0a1e072a74df36f` |
| 更新时间 | 2026-11-07 |

## 这套文档怎么读

| 文档 | 回答什么问题 | 什么时候读 |
|---|---|---|
| [01 定位](01-positioning.md) | 它是什么、解决谁的什么痛点、和竞品差在哪 | 第一次接触 |
| [02 架构](02-architecture.md) | 模块怎么分、数据怎么流、关键取舍 | 想理解全局 |
| [03 代码走读](03-code-tour.md) | 先读哪些文件、主流程怎么走 | 准备读代码 |
| [04 深挖：输入路由](04-deep-dive-routing.md) | 纯状态机、跨屏、触控板、游戏模式 | 想偷设计 |
| [04 深挖：网络与配对](04-deep-dive-network.md) | QUIC、SPAKE2、直连/中继、线程模型 | 想做实时网络 |
| [05 性能](05-performance.md) | 热路径、预算、复杂度、优化 | 做性能判断 |
| [06 分支](06-branches.md) | main 与 update-feed-state 差在哪 | 想知道版本差异 |
| [07 贡献](07-contribute.md) | 怎么跑、怎么测、怎么提 Issue | 想参与 |
| [08 收获](08-takeaways.md) | 10 个可迁移想法、面试卡片 | 做分享/面试 |
| [09 运维](09-ops.md) | 安装、数据路径、排障、回滚 | 要落地 |

## 快速开始

打开 [交互式 Guide](guide.html) 获得 10 分钟版本。

```bash
# 前端
npm ci
npm run -w apps/oink typecheck
npm run -w apps/oink test

# Rust
cargo test -p oink-routing
cargo build -p oink-ui
```

## 一句话记住

Oink 用**纯状态机**做输入路由，用 **QUIC** 承载所有实时流，用**线程所有权表**替代共享锁；它不是另一个 Synergy，而是把“跨设备”做成 P2P 的实时数据平面。
