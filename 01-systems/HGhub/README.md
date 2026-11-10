# HGhub

> 黄果短剧的第三方客户端：Tauri 2 + React 做壳，Rust 扛网络与媒体代理，前端只负责把 HLS 播得顺。

| 项 | 值 |
|---|---|
| 上游 | [Minireel/HGhub](https://github.com/Minireel/HGhub) |
| 应用地址 | [GitHub Releases](https://github.com/Minireel/HGhub/releases)（Windows / macOS / Android / Linux） |
| License | PolyForm Noncommercial 1.0.0（禁商业使用） |
| 语言 | TypeScript + Rust（Tauri 2 / React 19 / Vite 7） |
| 分析深度 | L2 |
| 分析 commit | `5f88442961ad9cdac50af4421cf76b3ac06d64e2` |
| 更新时间 | 2026-11-10 |

## 这套文档怎么读

| 文档 | 回答什么问题 | 什么时候读 |
|---|---|---|
| [01 定位](01-positioning.md) | 它是什么、和同类客户端差在哪、非商业条款意味着什么 | 第一次接触 |
| [02 架构](02-architecture.md) | 前端/原生怎么分工、一次播放请求走哪条路 | 想理解全局 |
| [03 代码走读](03-code-tour.md) | 先读哪些文件、主流程怎么走、加功能改哪里 | 准备读代码 |
| [04 深挖：媒体代理](04-deep-dive-media-proxy.md) | 封面 AES 解密、m3u8 全 URI 改写、为什么不用 CORS | 想偷媒体层设计 |
| [05 性能](05-performance.md) | 热路径在哪、缓存和缓冲区的实测边界 | 做性能判断 |
| [06 分支](06-branches.md) | 两条 codex 分支到底删了什么 | 想知道版本差异 |
| [07 贡献](07-contribute.md) | 怎么跑、怎么测、CI 怎么卡 | 想参与 |
| [08 收获](08-takeaways.md) | 可迁移想法、面试卡、局限与不该抄的地方 | 做分享/面试 |
| [09 运维](09-ops.md) | 装不上/打不开/播不动怎么排、数据在哪 | 要落地 |

## 快速开始

```bash
# 环境：Node 22 + pnpm 10 + Rust ≥ 1.90
pnpm install --frozen-lockfile
pnpm app:dev          # Tauri 桌面窗口（内部会起 vite :1420）
pnpm build            # tsc --noEmit + tests 类型检查 + vite build
```

exFAT 磁盘必须保持 `node-linker=hoisted`（已在 `.npmrc` / `pnpm-workspace.yaml` 固化），否则 `ERR_PNPM_EISDIR`。

## 一句话记住

HGhub 的价值不在界面，而在于它把「第三方客户端必然遇到的 CORS、防盗链、代理不生效、iOS 播放被打断」四类脏活全部下沉到 Rust：一条 `hg://` 自定义协议 + 一套不可信目标策略，前端只管 `hls.js`。

> 仅供学习研究。项目非官方、非商业授权，内容版权归上游站点与原权利人。
