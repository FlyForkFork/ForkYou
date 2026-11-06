# 04 深挖：docker.sock 容器编排与实例生命周期

> 这篇回答什么问题：一个面板如何在没有 k8s、没有 Swarm 的情况下，可靠地在单机上创建/重建/升级几十个有状态容器？WOC 的做法哪些能抄？

## 问题

WOC 的每个实例都是一台「有状态的小电脑」：容器可以随时重建，但 `/config` 里的微信登录态、聊天记录、浏览器 Cookie 不能丢。面板要同时满足：

- 从零创建：拉镜像、建卷、建容器、启动；
- 日常运维：启动/停止/重启/升级/删除；
- 异常恢复：面板重启后接管已有容器；实例卡死时重启；Docker 暂时连不上不能误删；
- 安全：实例之间、实例与面板之间不能随便互访。

## 朴素做法为什么不够

| 朴素做法 | 会出什么事 | 项目里的证据 |
|---|---|---|
| 在 HTTP 路由里同步 `docker run` | 拉镜像超过反代 60s，请求被掐断，前端报失败，用户重试 → 并发重建 | `panel/server/src/index.ts:518-525` 注释（#129） |
| 先删旧容器，再拉新镜像 | 网络失败时旧容器没了、新容器建不出来，实例直接消失 | `doc/dev/稳定性设计.md:59` |
| `docker inspect` 旧容器再克隆配置 | 克隆到过期 Hostname，自更新后全员 502 | `doc/dev/架构守则.md:16-20` |
| 用容器名当实例名 | 容器名可注入/冲突；改名后反代找不到 | `panel/server/src/store.ts:332-372` 用随机短 id 派生 `woc-wx-<id>` |
| 所有实例接默认 bridge | 实例能访问面板所在网络的其他容器（数据库等） | `panel/server/src/docker.ts:326-371` 专用网络；`panel/server/src/index.ts:149-155` 反向拒绝 |
| 删除实例就删卷 | 用户误点一下聊天记录全没 | `panel/server/src/index.ts:756-773` 默认保留卷，`purge=1` 才删 |

## 这个项目怎么做

### 1）命名与数据模型：id 是唯一事实源

`createInstance` 生成 10 位十六进制短 id，容器名 `woc-wx-<id>`、卷名 `woc-data-<id>`，KasmVNC 用户名固定 `woc`、密码 24 字节随机 hex（`panel/server/src/store.ts:332-372`）。复用旧卷时从卷名反解析 id（`panel/server/src/store.ts:342-348`），所以「删容器不删卷，再建一个实例挂同一个卷」是可行路径。

### 2）同一实例的变更串行化

所有重建走 `withLifecycle(instId, fn)`（`panel/server/src/docker.ts:741-745`），同一实例的启动/升级/自愈不会并发删建。这是单机编排里最便宜也最有效的锁：**锁粒度=实例**，不同实例仍可并行。

### 3）先备镜像，再删旧容器

`runInstanceNow` 的顺序是：`ensureImage` → `snapshotContainerLog`（留旧日志）→ 删旧容器 → 建新容器（`panel/server/src/docker.ts:749-763`）。镜像拉不下来就停在第一步，旧容器还在。

升级路径还多一层诚实：拉取失败但镜像没变时直接报「未升级」，不白白重启一次（`panel/server/src/docker.ts:914-920`）。

### 4）声明式 HostConfig

容器配置全部写死在 `runInstanceNow`：`Binds=[volume:/config]`、`NetworkMode`、`SecurityOpt seccomp=unconfined`、`ShmSize 1GB`、`RestartPolicy unless-stopped`、`LogConfig 20m×2`、内存上限、设备映射、MAC/Hostname（`panel/server/src/docker.ts:775-821`）。没有「inspect 旧容器再克隆」的路径——这是 R2 的代码体现。

### 5）网络自愈

面板启动时通过 `/proc/self/mountinfo` 里的容器 ID 认出自己（`panel/server/src/docker.ts:165-192`），再建/接入 `woc-instances` 网络（`panel/server/src/docker.ts:222-247`）。每 2 分钟复查一次，面板容器被外部工具重建丢了网络会自动接回（`panel/server/src/docker.ts:296-321`）。建不起来则退回面板所在网络并记日志（`panel/server/src/docker.ts:326-371`）。

### 6）把人话错误写进实例卡片

`ProvisionError` 把失败分成 `pull / volume / create / start` 四阶段，映射成「没空间 / 被限流 / manifest 不存在 / 内存不足 / 设备不存在 / 网络不存在」等可行动建议（`panel/server/src/docker.ts:573-629`）。失败原因写进 `Instance.createError`，面板重启后也不会无解释地自动重试（`panel/server/src/store.ts:61-66`）。

### 7）异步 provisioning

`startProvision` 维护 `provisioning` Map，立即返回，后台执行；前端轮询状态（`panel/server/src/index.ts:518-556`）。与「一键升级」共用同一套「长任务立即返回」原则（`panel/server/src/index.ts:900-956`）。

## 代码证据（7 条）

1. `panel/server/src/store.ts:332-372` — id/容器名/卷名/Kasm 凭据的唯一生成点。
2. `panel/server/src/docker.ts:741-763` — 每实例串行锁 + 先备镜像后删容器。
3. `panel/server/src/docker.ts:775-821` — 完整 HostConfig：卷、网络、seccomp、SHM、日志、内存。
4. `panel/server/src/docker.ts:165-247` — 用 mountinfo 自我识别 + 接入实例网络。
5. `panel/server/src/docker.ts:573-629` — ProvisionError 四阶段与人话建议。
6. `panel/server/src/index.ts:518-556` — 异步创建与状态 Map。
7. `panel/server/src/index.ts:756-773` — 删除默认保留数据卷，创建中返回 409。

## 复杂度与性能边界

| 维度 | 现状 | 边界 |
|---|---|---|
| 代码量 | `docker.ts` 2702 行，`index.ts` 2192 行 | 单文件过大，改一处要读很久 |
| 并发 | 每实例串行、实例间并行 | 没有全局调度器；几十个实例同时升级会打满 Docker/网络 |
| 拉镜像 | 5 分钟无进度判停滞（`panel/server/src/docker.ts:1465`） | 慢速但持续的下载不会超时；完全卡死会 |
| 卷操作 | 压缩包先暂存校验再写入（`panel/server/src/index.ts:1393-1396`） | 大卷备份占面板磁盘；`volBusy` 同实例串行 |
| 容器开销 | 每实例预留 1GB `/dev/shm`（`panel/server/src/docker.ts:74`） | tmpfs 按需占用，但上限是硬预留 |
| 恢复 | `keepImage` 重建 | 单机 Docker；宿主挂了就全挂，没有跨机迁移 |

## 取舍与局限

- **只支持单机 Docker**：没有 Swarm/K8s，实例不能跨节点调度。这是刻意的：目标用户是 NAS。
- **docker.sock = 宿主 root**：面板被攻破等于宿主被攻破（`doc/安全加固.md:11-27`）。socket-proxy 只按端点过滤，仍可 create privileged / 挂载任意目录（`doc/安全加固.md:57-63`）。
- **实例隔离不是安全隔离**：`seccomp=unconfined`（`panel/server/src/docker.ts:777`）是为了让 Chromium/微信能跑；容器共享内核。
- **删除卷不可逆**：`purge=1` 直接删；没有回收站。
- **创建失败不自动重试**：`createError` 有值时启动不再自动重试，避免每次开机都卡在拉镜像（`panel/server/src/store.ts:61-66`）。代价是用户必须手动点重试。

## 我能偷什么

1. **「先备镜像，再删旧容器」**——所有有状态容器重建都适用，顺序即正确性。
2. **`withLifecycle` 按实例加锁**——比全局锁并发好，比分布式锁便宜。
3. **id 派生资源名**——容器/卷/网络全部由同一个短 id 生成，删除和恢复都不会认错。
4. **错误分阶段 + 人话建议**——比抛原始 Docker 错误多写 30 行，用户支持成本降一个量级。
5. **恢复操作一律 `keepImage`**——把「重启」和「升级」彻底分开，避免隐式换版。

## 一句话记住

单机编排的可靠性不靠框架，靠四个顺序：**先锁实例、先备镜像、后删容器、恢复不换版**。
