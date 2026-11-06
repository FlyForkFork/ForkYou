# 01 定位：它是什么，谁需要，和谁不一样

> 这篇回答什么问题：WechatOnCloud 到底解决什么问题？它不是「微信多开」，那它是什么？市面上有哪些替代方案，差在哪？

## 先给结论

WechatOnCloud（下称 WOC）是一套**自部署的「服务端微信」**：把官方 Linux 版微信跑在 Docker 容器里的虚拟桌面上，面板负责创建/销毁实例、鉴权、反向代理；多个浏览器连同一个实例时，看到的是**同一个微信会话**，不是多个账号。

一句话：**它把「一台一直开着的、登录着微信的电脑」变成了 NAS 上的一个容器，再把这块桌面安全地分给多个浏览器。**

证据：`README.md:7-9` 定位「在自己的 NAS / 服务器上运行服务端微信，多端浏览器共享同一会话」；`README.md:39-41` 说明每实例=容器（Xvfb + 应用 + KasmVNC），面板是唯一入口。

## 它不是什么

| 常见误解 | 事实 | 证据 |
|---|---|---|
| 微信多开器 | 一个实例 = 一个微信登录态；多开要建多个实例、多个微信号 | `doc/技术方案.md:7-15` |
| 多租户 SaaS | 子账号共享同一个会话，只是访问权限不同；不是每人一个微信 | `README.md:141` |
| 修改版微信 | 用腾讯官方 Linux 微信 deb，不碰客户端 | `README.md:39`；`docker/Dockerfile:4-8` |
| 虚拟机 + 远程桌面 | 容器内 Xvfb + KasmVNC，比 VM 轻，但不是强隔离 | `doc/技术方案.md:23-29` |

## 目标用户与真实痛点

| 用户 | 痛点 | WOC 的解法 |
|---|---|---|
| NAS 玩家 / 家庭服务器用户 | 想在手机、平板、公司电脑上看同一个微信，又不想一直开着一台 PC | 微信常驻 NAS，浏览器随开随用 |
| 小团队 / 工作室 | 一个业务微信号需要多人轮流处理消息 | 子账号 RBAC，按实例授权，共用同一会话 |
| 需要「云端浏览器」的人 | 想常驻登录 Telegram / X / Instagram 等网页应用 | Chromium 实例同样容器化、数据卷持久化 |
| 运维/自部署爱好者 | 不想把账号交给云手机厂商 | 全部数据留在自己机器 |

## 为什么是现在

- 微信官方 Linux 版 2024-11 上线，提供 x86_64 / arm64 的 deb，才让「容器里跑原版微信」可行（`doc/技术方案.md:60-66`）。
- KasmVNC 1.5.x、linuxserver 的 KasmVNC baseimage、NAS 上的 Docker Compose 都已成熟，才有「浏览器里开桌面」的体验。
- 家用 NAS 的性能足够：4 核 / 8GiB 能跑 3–4 个实例（`README.md:175-178`）。

## 项目健康度（GitHub API，2026-11-07）

| 指标 | 值 | 说明 |
|---|---|---|
| Stars | 3967 | 2026-05-29 创建，增长很快 |
| Forks | 850 | fork 多说明自部署需求强 |
| Open issues | 45 | 问题不少，属于活跃维护期 |
| 最新 release | v1.6.0（2026-10-28） | 远程桌面换 KasmVNC 1.5.2、单连接接管、大图粘贴修复 |
| 最近 commit | 2026-11-01 | main 仍在更新 |
| License | NOASSERTION | 无 LICENSE 文件，商用需授权 |
| Contributors | 未拉取完整名单，标 `待查实` | README 致谢多位 issue/PR 贡献者 |

## 竞品对比

| 方案 | License | 形态 | 与 WOC 的关键差异 |
|---|---|---|---|
| **WechatOnCloud** | **NOASSERTION**（无 LICENSE 文件） | 面板 + 多实例容器 + KasmVNC | 多实例、RBAC、生命周期、数据卷、中文输入都自己做；复杂度最高 |
| [RICwang/docker-wechat](https://github.com/RICwang/docker-wechat) | Apache-2.0 | 单个 Docker 容器，web/VNC 访问 | 只解决「把微信跑进容器」；无面板、无多实例编排、无子账号。构建时从微信官网解析最新 deb |
| [LinuxServer Webtop](https://docs.linuxserver.io/images/docker-webtop/) | GPL-3.0 | 通用 Web 桌面基础镜像 | 给你一个浏览器里的 Linux 桌面，不负责微信安装/更新、实例编排、权限模型；要自己搭 |
| 云手机 / 云电脑 SaaS | 商业闭源 | 厂商托管的虚拟设备 | 按机付费、数据在厂商；WOC 是自托管、一次部署 |
| 微信原生多开 / 多设备 | 商业闭源 | 客户端功能 | 不是服务端方案；无法让任意浏览器共享同一会话，也无法集中管理 |

结论：**单容器方案赢在简单，WOC 赢在「把一台机器变成可运营的服务」**——代价是它必须挂 docker.sock、自己处理鉴权/反代/升级，运维门槛明显更高。

## License 风险（必须正视）

仓库根目录**没有 LICENSE 文件**（分析 commit `86d8251` 的文件树），GitHub 因此显示 NOASSERTION。按伯尔尼公约默认规则，无许可证=保留所有权利：

- 个人自用、学习阅读通常没问题；
- **商用、对外提供服务、二次分发修改版，需要先取得作者书面许可**；
- 不能把「GitHub 公开可克隆」等同于「可以随便用」。

`README.md:229` 写明创意启发自懒猫微服。推断：这是独立实现，并非某个开源项目的 fork 许可继承。

## 什么时候不该选它

- 只有一个人、一台设备用微信 → 直接用官方客户端，别引入容器和 docker.sock。
- 需要强隔离的多租户 → 容器不是安全边界，应上 VM。
- 不能接受「面板 = 宿主 root」的风险 → 先读 `doc/安全加固.md:11-27`，或改用 socket-proxy 方案（仍有残余风险）。

## 入口与安装包

- 源码 / 文档：https://github.com/Gloridust/WechatOnCloud（`README.md`、`doc/`）
- 应用地址：自部署，默认 `http://NAS_IP:36080`（面板是唯一对外入口）
- 安装包：Docker 镜像 `docker.io/gloridust/{woc-panel,wechat-on-cloud}`，备用 `ghcr.io/gloridust/...`；飞牛 `.fpk` 工程在 `fnos/`，尚未真机验证（`fnos/README.md:32-41`）

## 外部来源

- [Gloridust/WechatOnCloud](https://github.com/Gloridust/WechatOnCloud)（README，2026-11-01）
- [微信 Linux 版官网](https://linux.weixin.qq.com/)（版本 4.1.13，2026-11-07）
- [RICwang/docker-wechat](https://github.com/RICwang/docker-wechat)（Apache-2.0）
- [LinuxServer Webtop 文档](https://docs.linuxserver.io/images/docker-webtop/)（GPL-3.0）
- [KasmVNC 1.5.2 Release Notes](https://github.com/kasmtech/KasmVNC/releases/tag/v1.5.2)（2025-10-24）

## 一句话记住

WOC 卖的不是「微信多开」，是「把一台登录着微信的桌面，变成有权限、有生命周期、可远程访问的服务」。
