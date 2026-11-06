# WechatOnCloud（云微）

> 在 NAS / 服务器上跑「服务端微信」，多端浏览器共享同一会话；一个面板管多个容器化实例（微信 / QQ / Chromium）。

| 项 | 值 |
|---|---|
| 上游 | [Gloridust/WechatOnCloud](https://github.com/Gloridust/WechatOnCloud) |
| 应用地址 | 自部署（默认 `http://NAS_IP:36080`，无官方 SaaS） |
| License | NOASSERTION（仓库无 LICENSE 文件，见 01/09 风险提示） |
| 语言 | TypeScript + Docker/Shell |
| 分析深度 | L2 |
| 分析 commit | `86d82519c5e6b28aae7ef3caa279086afa244d4d` |
| 更新时间 | 2026-11-07 |

## 这套文档怎么读

| 文档 | 回答什么问题 | 什么时候读 |
|---|---|---|
| [01 定位](01-positioning.md) | 它是什么、解决谁的什么痛点、和竞品差在哪 | 第一次接触 |
| [02 架构](02-architecture.md) | 模块怎么分、数据怎么流、关键取舍 | 想理解全局 |
| [03 代码走读](03-code-tour.md) | 先读哪些文件、主流程怎么走 | 准备读代码 |
| [04 深挖：容器编排](04-deep-dive-docker-lifecycle.md) | docker.sock、实例生命周期、网络隔离怎么做 | 想偷容器编排 |
| [04 深挖：KasmVNC 反代](04-deep-dive-kasmvnc-proxy.md) | WebSocket 单连接、卡死自愈、输入桥 | 想偷远程桌面链路 |
| [04 深挖：认证与安全](04-deep-dive-auth-security.md) | 登录、RBAC、Host 校验、docker.sock 边界 | 要做安全评审 |
| [05 性能](05-performance.md) | 内存/CPU 账、热路径、容量估算 | 做性能判断 |
| [06 分支](06-branches.md) | 10 个分支谁旧谁新、哪些可忽略 | 想知道版本差异 |
| [07 贡献](07-contribute.md) | 怎么跑、怎么测、怎么提 PR | 想参与 |
| [08 收获](08-takeaways.md) | 可迁移想法、面试卡片 | 做分享/面试 |
| [09 运维](09-ops.md) | 部署、配置、故障模式、升级回滚 | 要落地 |

## 快速开始

打开 [交互式 Guide](guide.html) 获得 10 分钟版本。

```bash
mkdir woc && cd woc
curl -fsSL https://raw.githubusercontent.com/Gloridust/WechatOnCloud/main/docker-compose.yml -o docker-compose.yml
# 先改默认密码：默认 admin / wechat
docker compose up -d
# 浏览器访问 http://<NAS_IP>:36080
```

## 一句话记住

它不是「微信多开」，而是把一台登录着微信的 Linux 桌面放进容器，再用面板把这块桌面安全地分给多个浏览器。
