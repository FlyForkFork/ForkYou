# 08 收获：可迁移的 10 个想法与 10 张面试卡

> 这篇回答什么问题：哪些设计值得抄？哪些是坑？面试聊它时怎么讲清楚？

> **流程声明**：RULES §6 要求 deep 档做「面试官 + 面试者」双 Agent 模拟面试。本次执行环境 delegation depth 已用尽（`subagent` 返回 `depth 2 exceeds maxDepth 1`），**双 Agent 未能启动**；下列 10 题与回答由本 Agent 分别以面试官/面试者视角撰写，材料来自对 `86d82519` 的代码复核，无证据处标 `待查实`。交付回复中同步声明，不伪装成真实双 Agent 产物。

## 可迁移的 10 个想法

**1）先备镜像，再删旧容器。** `ensureImage()` 成功后才快照日志、删旧容器（`docker.ts:751-763`）。失败时旧服务仍在，不会「升级升没了」。用在任何有状态容器重建。

**2）恢复操作永远不换版本。** 自愈/重启一律 `runInstance(inst,{keepImage:true})`（`docker.ts:753`），只有显式升级才换镜像（`docker.ts:880-926`）。用户没点升级，系统就不能升级。做法：把「重建」和「升级」拆成两个 API，恢复路径只读当前 digest。

**3）单写者 lease + viewer 标识。** 每页面一个 viewer id，新页面接管时旧页面标 superseded、断 socket、转移控制权；被接管页自动重连直接 409（`index.ts:1092-1141`、`1999-2014`）。被接管方必须**人点**才能抢回，避免无限互踢。

**4）用真实请求判活，别另起健康检查。** 反代层给上游挂计时器：25 秒内既无响应也无 101 才算一次 hang，快速失败不计数（`index.ts:1738-1787`）。信号来自用户实际路径，不受预热期与后台标签页影响。

**5）声明式重建，绝不克隆旧容器。** 所有 create 参数写死在 `runInstanceNow`（`docker.ts:771-821`）；面板自更新甚至显式省略 Hostname（`self-update.ts:111-113`）。重建函数里不允许「读旧对象再改两个字段」。

**6）错误分阶段 + 人话建议。** `ProvisionError` 分 pull/volume/create/start 四阶段，正则映射到「没空间/被限流/manifest 不存在/内存太小/网络被删」并给下一步（`docker.ts:554-629`）；错误持久化到实例卡片，重启不丢。

**7）资源边界三件套。** 容器日志 20m×2（`docker.ts:780-782`）、面板日志 512KB/365 天（`logs.ts:12-14`）、上传流式 spool + 256MiB 预留（`upload.ts:57-102`）、崩溃转储 1 天 TTL（`autostart:186-189`）。评审新功能只问一句「它的上限是什么」。

**8）服务端凭据注入 + 上游 401 头剥离。** 凭据存服务端，反代注入 `Authorization`，同时删掉上游 `www-authenticate`（`index.ts:1789-1796`、`1829-1831`）。前端零秘密，也不弹原生登录框。

**9）按网络原点拒绝。** 实例只接专用网络；面板以 `GwPriority:-1` 接入不抢网关；面板 403 来自该网段请求，判定时**排除网关**（`docker.ts:222-261`、`index.ts:150-155`）。边界落在网络层。

**10）发布门禁写成可执行命令。** `doc/dev/发布门禁.md` 全是可复制命令 + 期望输出，并真的搬进 CI 冒烟 job（`release.yml:74-103`），探针针对「用户动作」（点开公众号）而非「进程启动」。

## 面试卡（10 张）

**Q1 为什么用容器而不是 VM？**
A：目标用户是 NAS，内存只有几个 GiB。容器 + Xvfb + KasmVNC：空闲约 0.6 GiB、活跃 1–1.5 GiB，4 核 8 GiB 跑 3–4 个。代价是共享内核，实例还得 `seccomp=unconfined`（`docker.ts:777`）。我们从没说容器是安全边界。
追问：怎么防实例打面板？——实例只接专用网络，面板 403 来自该网段的请求并排除网关（`docker.ts:251-261`）。

**Q2 多用户怎么共享一个微信？**
A：不是多租户，是共享同一块桌面、同一个进程。子账号有 `allowedInstances`，`userCanAccess` 决定能否进实例（`store.ts:304-313`）。「共享」是物理意义的共享，不是协议同步。
追问：两人同时操作？——同一实例只保留一条桌面连接，新页面接管，被接管方要人点才能抢回。

**Q3 KasmVNC 密码怎么保护？**
A：凭据只在服务端实例记录里随机生成（`store.ts:340-361`）；API 返回 `publicInstance` 字段白名单，连容器名和卷名都不给（`store.ts:257-268`）；反代时注入 Basic，浏览器拿不到，同时删上游 401 的 `www-authenticate`（`index.ts:1789-1796`、`1829-1831`）。
追问：为什么密码必须是 hex？——容器内 `openssl passwd -apr1 ${PASSWORD}` 没加引号，base64url 的 `-` 会被当命令行选项。

**Q4 KasmVNC 卡死怎么办？**
A：不猜，看用户请求。反代层计时：25 秒内既无响应也无 101 记一次 hang，快速失败不计数；10 分钟 2 次、运行满 3 分钟、不在 15 分钟冷却内，才 `keepImage` 重启（`index.ts:1738-1787`）。页面先拿每 3 秒重载、最多 10 次的自动重连页，不是黑屏死页。
追问：根因？——没有。压测 100~150 次一组未复现，只有 `kill -STOP` 冻结 Xvnc 能稳定复现，所以是检测+重启，不是修复。

**Q5 为什么同一实例只允许一个页面？**
A：两个有证据的原因：EncCache 只在 ≥2 连接时启用且泄漏（KasmVNC#371：两连接滚动 1 分钟 88→260 MiB，1.5.2 未修）；双 ws 并存会卡死 Xvnc，修过四次。所以实例侧 `-NeverShared`，面板侧再用 viewer 标识挡住被接管页面，否则它自动重连又把新页面踢掉。
追问：代价？——不能同屏协作，只能接管，这是硬限制。

**Q6 升级面板和升级实例的区别？**
A：两个镜像、两个生命周期。面板自更新是 watchtower 式：拉新镜像 → 派生 helper 容器 stop/remove/create/start → `waitStable` 连续稳定 8 秒（上限 60 秒），失败回滚旧镜像 id（`self-update.ts:187-223`、`259-281`）。实例升级保留数据卷，并恢复原运行状态——本来停着的仍停着（`docker.ts:896-905`）。
追问：为什么自更新要省略 Hostname？——v1.2.6 克隆旧 hostname，`getContainer(hostname())` 404，实例落 bridge，全员 502。

**Q7 最大的安全风险？**
A：面板挂 `docker.sock` = 宿主 root：可挂宿主 `/` 跑 chroot 容器、可 `--privileged` 逃逸、可停删所有容器。加固是插 socket-proxy，只放行 CONTAINERS/EXEC/IMAGES/VOLUMES/POST/INFO/NETWORKS。但它是按端点不按请求体过滤，`POST=1` 仍可 create privileged、`EXEC=1` 仍可注入命令——缩小攻击面，不是隔离。
追问：那还值得做？——值得，但要把残余风险写进文档而不是当成解决了（`doc/安全加固.md:57-63`）。

**Q8 怎么防 DNS rebinding？**
A：Host 白名单（loopback、RFC1918、链路本地、CGNAT `100.64/10` 为 Tailscale 而加、IPv6 ULA）+ `PANEL_ALLOWED_HOSTS`。关键一条：Host 是外部多段域名时**一律不看 `X-Forwarded-Host`**（浏览器脚本也能伪造）；只有 Host 是「反代连面板的内部地址」才看 XFH 第一段。这条是被实测打出来的——早期「任一命中即放行」被用默认账号登录并调了管理接口（`host-guard.ts:121-139`）。
追问：默认口令还敢留 `wechat`？——首次启动会标 `mustChangePassword`，但没有强制拦截，这是已知缺口。

**Q9 中文输入为什么这么绕？**
A：VNC 键盘走 keysym，中文靠 IME 合成，逐字符差分发送会丢字且 keysym 有容量上限。两条腿：镜像侧给 KasmVNC web 客户端打四处补丁（默认开 IME、合成中不按 keysym 实时发、`getType()` 抛错不再致命，`woc-www-patch.sh:1-30`）；面板侧 `/type` 用「写容器剪贴板 + xdotool Ctrl+V」，按 500 字切片（`docker.ts:2136-2158`）。前端按 `compositionend` 排队，保证转发期间按下的键排在中文之后。
追问：xdotool 参数？——`keyup --delay 0 <所有修饰键> key <key>`，不能用 `--clearmodifiers`，否则它用 XTEST 把 Ctrl 按回去，粘完图再打中文会发出一个「v」。

**Q10 如果重做会改什么？**
A：三件。拆 `index.ts`（2192 行）与 `docker.ts`（2702 行）为 proxy/lifecycle/auth/volume；引入最小测试框架，先给 `host-guard.ts`（140 行纯函数）与 `tar.ts` 写单测；`bcrypt.compareSync` 改异步，登录风暴下它阻塞整个事件循环（`store.ts:191-193`）。架构层面的编排顺序、单连接、keepImage 一条不改——它们是拿事故换来的。
追问：为什么不换 KasmVNC？——它目前是唯一「单端口 + WebSocket + 剪贴板 + 音频」跑通的方案，换 Selkies 要重验全部补丁；但 baseimage 已停更，是定时炸弹。

## 可以吹的 5 个点

1. **单文件 2702 行的容器编排**，创建/升级/备份/诊断/剪贴板/字体壁纸全塞进一套生命周期，还带每实例串行锁。
2. **10 条架构守则全部从 P0 蒸馏**，每条带「学费」与事故编号，比很多公司的 ADR 硬。
3. **CI 用原生 arm64 runner 替代 QEMU**，直接消灭 apt OOM 导致的镜像发布失败（`release.yml:6-9`）。
4. **单连接 viewer 设计**，同时规避 EncCache 泄漏与「双 ws 卡死 Xvnc」，且对旧镜像也生效。
5. **手写 tar + 自拆 Docker 多路复用帧**，把「整卷恢复 3GB 峰值十几 GB 被 OOM」压到常数内存（`tar.ts`、`docker.ts:1941-1982`）。

## 不该抄的 5 个点

| 不该抄 | 原因 | 更好的做法 |
|---|---|---|
| 裸挂 `docker.sock` 的默认部署 | 面板被攻破 = 宿主 root | 至少 socket-proxy；能接受就独立宿主 + 网络隔离 |
| `seccomp=unconfined` | 为兼容 Chromium 牺牲隔离 | 先试默认 profile + 精确 syscall 白名单 |
| 没有自动化测试 | 回归靠人 | 至少给纯函数模块（host-guard / tar / crash-diag）补单测 |
| `bcrypt.compareSync` | 阻塞事件循环 | 异步版或 argon2 |
| 2000+ 行单文件模块 | review 成本高 | 按域拆模块，路由只做校验与鉴权 |

## 一句话记住

WOC 最值得偷的不是某个函数，是**「把每次 P0 变成一条硬约束、再把约束变成可执行门禁」的工程习惯**——代码会过时，约束不会。
