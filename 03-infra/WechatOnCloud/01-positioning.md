# 01 定位：一台常驻的「微信电脑」，被切成可授权的服务

> 这篇回答什么问题：WechatOnCloud 解决的是什么问题？它不是微信多开，那它到底是什么？同类方案有哪些，各自的天花板在哪，什么情况下根本不该选它？

## 先给结论

WechatOnCloud（下称 WOC）是一套**自部署的「服务端微信」**：把腾讯官方 Linux 版微信跑在容器里的虚拟 X 桌面上，用一块自研面板负责实例创建、鉴权、反向代理和升级，多个浏览器连同一个实例时看到的是**同一块桌面、同一个微信进程**，不是多个账号。

一句话：**它把「一台一直开着、登录着微信的电脑」变成 NAS 上的一个容器，再把这块桌面按账号授权给多个浏览器。**

证据：`README.md:7` 定位「在自己的 NAS / 服务器上运行『服务端微信』，多端浏览器共享同一会话」；`README.md:41` 一句话原理写明「每个实例 = 一个容器，里面跑 Xvfb 虚拟显示 + 一个应用，KasmVNC 把画面串到浏览器」；`docker/Dockerfile:4` 基座是 `lscr.io/linuxserver/baseimage-kasmvnc:debianbookworm`。

## 它不是什么

误解比无知更贵，先把边界划清。

| 常见误解 | 事实 | 证据 |
|---|---|---|
| 微信多开器 | 一个实例 = 一个微信登录态；要多个号就建多个实例、各占 1GiB+ 内存 | `panel/server/src/store.ts:43-67`（Instance 记录含独立 `volumeName`）；`docker.ts:774-783`（每实例独立卷 + 1GiB shm） |
| 多租户 SaaS | 子账号只是「谁能进这个实例」；同一实例的授权用户共享同一微信，互相看得见操作 | `panel/server/src/store.ts:310-313`（`userCanAccess`）；`README.md:51` |
| 修改版微信 | 用腾讯官方 deb，不碰客户端二进制；镜像构建期**不装**微信，运行时下载 | `docker/Dockerfile:6-8`；`docker/wechat-ctl.sh:19-20`（CDN 指向 `dldir1v6.qq.com`） |
| 云手机 / 云电脑 | 容器不是安全边界，共享宿主内核，且实例用 `seccomp=unconfined` | `panel/server/src/docker.ts:777` |
| 一个「网页版微信」 | 它是像素级远程桌面（VNC），不是协议级客户端；所以不需要破解协议，也不受网页版功能限制 | `panel/server/src/index.ts:1886-1906`（`/desktop/:id/*` 整段反代） |

## 它真正的技术赌注

定位之外，WOC 还押了三个技术赌注。它们决定了这个项目为什么长成现在这样，也决定了它的天花板。

**赌注一：用「像素级远程桌面」代替「协议级客户端」。** 微信没有开放 API，破解协议违法且随时失效；网页版功能残缺。WOC 选择把官方 Linux 客户端跑在虚拟显示上，用 VNC 把画面串出来。好处是**完全不碰客户端**，微信怎么更新都不用跟；代价是所有输入输出都要在像素和键鼠层面重建——中文输入、剪贴板、图片粘贴、音频，每一项都是独立的大坑（见 04 深挖）。

**赌注二：用「容器」代替「虚拟机」。** NAS 的内存只有几个 GiB，VM 起不来。代价是共享内核、实例必须 `seccomp=unconfined`（`docker.ts:777`），并且系统必须明说自己不是安全边界。

**赌注三：用「单机 Docker API」代替「编排框架」。** 面板直接拿 docker.sock 当调度器，不引 k8s/Swarm。好处是部署只有一个 compose 文件；代价是面板一旦被攻破就等于宿主 root，而且所有可靠性都要自己用顺序和锁堆出来（见 04 深挖）。

三个赌注串起来就是一句话：**它用「不碰客户端」换来了长期可维护，又用「单机 Docker」换来了部署简单，最终把全部复杂度压在了面板这一个进程上**——`docker.ts` 2702 行、`index.ts` 2192 行，就是这笔账的账单。

## 目标用户与真实痛点

| 用户 | 痛点 | WOC 的解法 | 代价 |
|---|---|---|---|
| NAS 玩家 / 家庭服务器用户 | 想在手机、平板、公司电脑看同一个微信，但不想 24 小时开着一台 PC | 微信常驻 NAS，浏览器随开随用，换设备即接管 | 多一台常开的机器，且要维护容器 |
| 小团队 / 工作室 | 一个业务微信号需要多人轮流处理 | 子账号 + 按实例授权（RBAC） | 无并发协作，同一时刻只有一处能操作 |
| 需要「云端浏览器」的人 | 想常驻登录 Telegram / X / Instagram 网页版 | `chromium` 应用类型同样容器化、登录态写进数据卷 | 网页版风控、需要自己判断合规 |
| 自部署洁癖患者 | 不愿把账号交给云手机厂商 | 全部数据留自己机器，镜像自己拉 | 面板挂 docker.sock，等于把宿主 root 交出去 |

## 为什么是现在

- 微信官方 Linux 版提供 x86_64 / arm64 的 deb，才让「容器里跑原版微信」成为可能（`docker/wechat-ctl.sh:19-20` 的 CDN 路径、`docker/app-ctl.sh:11-12` 的 install 流程；外部信息见 [linux.weixin.qq.com](https://linux.weixin.qq.com/)，2026-11-07 查阅）。
- KasmVNC 把「X 桌面 → 浏览器」这条路做到了可用：单端口、WebSocket、剪贴板、音频（`docker/Dockerfile:70-99` 锚定 1.5.2）。
- NAS 上的 Docker Compose 已足够成熟，`docker compose up -d` 就是全部安装步骤（`docker-compose.yml:1-79`）。

## 项目健康度

只写能从仓库本身证实的，其余标 `待查实`。

| 指标 | 值 | 证据/说明 |
|---|---|---|
| Stars | 3967 | `_cache/work/WechatOnCloud/work.json`（2026-11-10 抓取） |
| License | NOASSERTION | 仓库根无 LICENSE 文件（`git ls-files` 94 项中无 LICENSE） |
| 最新 tag | `v1.6.0`（2026-10-29） | `git log -1 v1.6.0` → `2cb1d73`，Merge PR #172 |
| 分析 commit | `86d82519`（2026-11-01） | main tip，比 v1.6.0 多若干 UI 提交 |
| 分支 | 10 个，9 个已并入 main | 见 06 |
| Forks / Open issues / Contributors | `待查实` | 本次未联网核对，旧文档的 850/45 无本地证据，已删除 |

## 竞品对比

| 方案 | License | 形态 | 与 WOC 的关键差异 |
|---|---|---|---|
| **WechatOnCloud** | NOASSERTION（无 LICENSE） | 面板 + 多实例容器 + KasmVNC + RBAC | 把「跑起来」做成「可运营」：生命周期、升级、备份、诊断、输入法全自己做；复杂度最高 |
| [RICwang/docker-wechat](https://github.com/RICwang/docker-wechat) | Apache-2.0 | 单容器 + web/VNC | 只解决「微信进容器」；无面板、无多实例编排、无子账号、无升级链路 |
| [LinuxServer Webtop](https://docs.linuxserver.io/images/docker-webtop/) | GPL-3.0 | 通用 Web 桌面基础镜像 | 给你一块浏览器里的 Linux 桌面，不负责应用安装/更新、实例编排、权限模型 |
| 云手机 / 云电脑 SaaS | 商业闭源 | 厂商托管虚拟设备 | 按机付费、数据在厂商；WOC 是一次部署、数据自持 |
| 微信自带多设备登录 | 商业闭源 | 客户端功能 | 不是服务端方案；不能让任意浏览器共享同一会话，也无法集中授权 |

结论：**单容器方案赢在「三十行 compose 就能跑」，WOC 赢在「把一台机器变成有权限、有生命周期、能升级的服务」**——代价是它必须挂 docker.sock，自己承担鉴权、反代、升级的全部失败模式。

## License 风险（必须正视）

仓库根目录**没有 LICENSE 文件**（分析 commit `86d82519` 的 `git ls-files` 共 94 项，无 LICENSE）。GitHub 因此标 NOASSERTION。按伯尔尼公约默认规则，无许可证 = 保留所有权利：

- 个人自用、阅读学习通常没问题；
- **商用、对外提供服务、二次分发修改版，需要先取得作者书面许可**；
- 「GitHub 公开可克隆」不等于「可以随便用」。

`README.md:229` 写明「创意启发自懒猫微服」。推断：这是独立实现，不继承任何开源项目的许可。

## 什么时候不该选它

- 只有一个人、一台设备用微信 → 直接用官方客户端，别为它引入 docker.sock。
- 需要强隔离的多租户 → 容器不是安全边界，应上 VM 或独立主机。
- 不能接受「面板 = 宿主 root」→ 先读 `doc/安全加固.md:11-27`；即使用 socket-proxy，`EXEC=1` 仍可注入（`doc/安全加固.md:57-63`）。
- 需要多人**同时**操作同一个微信 → 单连接设计（`docker/Dockerfile:138-141`）直接排除这个场景。

## 入口

- 源码与文档：https://github.com/Gloridust/WechatOnCloud
- 应用地址：自部署，默认 `http://NAS_IP:36080`（`docker-compose.yml:69`）
- 镜像：`docker.io/gloridust/{woc-panel,wechat-on-cloud}`，备 `ghcr.io/gloridust/...`（`docker-compose.yml:7-13`）
- 飞牛应用包工程：`fnos/`，`fnos/woc/manifest` 标 `os_min_version=0.9.0`，README 注明待真机验证（`README.md:220`）

## 外部来源

- [Gloridust/WechatOnCloud](https://github.com/Gloridust/WechatOnCloud)（README，2026-11-01）
- [微信 Linux 版官网](https://linux.weixin.qq.com/)（2026-11-07 查阅）
- [RICwang/docker-wechat](https://github.com/RICwang/docker-wechat)（Apache-2.0，2026-11-07 查阅）
- [LinuxServer Webtop 文档](https://docs.linuxserver.io/images/docker-webtop/)（GPL-3.0，2026-11-07 查阅）
- [KasmVNC v1.5.2 Release Notes](https://github.com/kasmtech/KasmVNC/releases/tag/v1.5.2)（2025-10-24）

## 一句话记住

WOC 卖的不是「微信多开」，是**「把一台登录着微信的桌面，变成有权限、有生命周期、可远程访问的服务」**——而它的全部风险也来自同一句话：这块桌面的钥匙，是宿主 root。
