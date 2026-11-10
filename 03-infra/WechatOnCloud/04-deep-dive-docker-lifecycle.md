# 04 深挖：docker.sock 容器编排与实例生命周期

> 这篇回答什么问题：没有 k8s、没有 Swarm，一个面板怎么在单机上可靠地创建/重建/升级几十个有状态容器？哪些顺序是正确性的一部分？

## 问题

WOC 的每个实例都是一台「有状态的小电脑」：容器随时可以重建，但 `/config` 里的微信登录态、聊天记录、浏览器 Cookie 不能丢。面板要同时满足四类需求：

- **从零创建**：拉镜像、建卷、建容器、启动，任何一步失败都要能说清原因；
- **日常运维**：启动 / 停止 / 重启 / 升级 / 删除，且不能互相踩；
- **异常恢复**：面板重启后接管已有容器；实例卡死时重启；Docker 暂时连不上不能误判成「容器不存在」；
- **边界**：实例之间、实例与面板之间不能随便互访。

## 朴素做法为什么不够

| 朴素做法 | 会出什么事 | 证据 |
|---|---|---|
| 在 HTTP 路由里同步 `docker run` | 拉镜像超过反代 60s，请求被掐断，前端报失败，用户重试 → 并发重建 | `panel/server/src/index.ts:518-525` 注释（#129） |
| 先删旧容器，再拉新镜像 | 网络失败时旧容器没了、新容器建不出来，实例直接消失 | `panel/server/src/docker.ts:756-758` 注释 |
| `docker inspect` 旧容器再克隆配置 | 克隆到过期 Hostname，自更新后 `getContainer(hostname())` 404 → 实例落 bridge → 全员 502 | `panel/server/src/self-update.ts:111-113`（v1.2.6 事故） |
| 用容器名当实例名 | 容器名可注入/冲突；改名后反代找不到 | `panel/server/src/store.ts:340-361` 用随机短 id 派生 |
| 所有实例接默认 bridge | 实例能访问面板所在网络的其他容器（数据库等）；且默认 bridge 不支持按容器名解析 | `panel/server/src/docker.ts:347-357` 注释 |
| 删除实例就删卷 | 用户误点一下聊天记录全没 | `panel/server/src/index.ts:756-773`：默认保留，`purge=1` 才删 |
| 只判断「容器不存在」 | Docker 一时连不上时把 `ping` 失败当 404，直接重建 → 双份容器抢同一个卷 | `panel/server/src/docker.ts:845-855`：只有 404 才重建 |

## 核心机制

### 1）id 是唯一事实源

`createInstance` 生成 10 位十六进制短 id（`randomBytes(5).toString('hex')`），容器名 `woc-wx-<id>`、卷名 `woc-data-<id>`，KasmVNC 用户名固定 `woc`、密码 24 字节随机 hex（`store.ts:340-361`）。

密码必须 hex 而不是 base64url，原因写在注释里：容器内 `openssl passwd -apr1 ${PASSWORD}` 没加引号，base64url 的 `-` 会被当成命令行选项。

复用旧卷时从 `woc-data-<10hex>` 反解 id（`store.ts:318-321`、`342-348`），所以「删容器不删卷，再建实例挂同一个卷」是受支持的路径。

### 2）同一实例的变更串行化

所有重建走 `withLifecycle(inst.id, fn)`（`docker.ts:738-748`）。注释说得直白：手动重启、看门狗、卡死自愈、升级撞在一起会「删旧建新」互相破坏。

这是单机编排里最便宜也最有效的锁：**锁粒度 = 实例**，不同实例仍可并行。

### 3）先备镜像，再删旧容器

`runInstanceNow` 的顺序固定（`docker.ts:751-841`）：

```text
ensureImage(可能拉镜像，失败即抛) → snapshotContainerLog(留旧日志 200 行)
→ 删旧容器 → ensureInstanceVolume → create → start(失败则 remove --force)
```

镜像拉不下来就停在第一步，旧容器还在。start 失败必须 `container.remove({force:true})`，否则留一个未启动容器占着 `woc-wx-<id>` 名字，下次创建直接冲突（`docker.ts:832-841`）。

### 4）声明式 HostConfig

容器配置全部写死在 `runInstanceNow`（`docker.ts:771-821`）：`Binds=[volume:/config]`、`NetworkMode`、`SecurityOpt seccomp=unconfined`、`ShmSize 1GiB`、`RestartPolicy unless-stopped`、`LogConfig json-file 20m×2`、可选内存上限（`Memory` 与 `MemorySwap` 同值以禁 swap）、摄像头设备 + `GroupAdd:['video']`、GPU 时的 render/video 设备与真实 GID、`Hostname` 与 MAC 伪装。

没有「inspect 旧容器再克隆」的路径——这是守则 R2 的代码体现。

### 5）网络自愈

面板靠 `/proc/self/mountinfo` 里的容器 id 认出自己（正则匹配 `/<64hex>/hostname` 之类，`docker.ts:165-174`），候选依次是 mountinfo → `hostname()` → `WOC_PANEL_CONTAINER||'woc-panel'`（`docker.ts:181-192`，注释引 #103）。

建/接入 `woc-instances` 网络时用 `EndpointConfig:{GwPriority:-1}` 保证默认网关不变（`docker.ts:222-247`）。之后每 15 秒首查、每 2 分钟复查（`docker.ts:296-321`），面板容器被外部工具重建丢了网络会自动接回。

`resolveNetwork` 的注释是另一种学费：默认 bridge 不支持按容器名解析，旧逻辑「取排序第一个网络」会选中 bridge 导致实例全 502（`docker.ts:347-357`）。

### 6）把人话错误写进实例卡片

`ProvisionError` 把失败分成 `pull / volume / create / start` 四阶段（`docker.ts:554-571`），再用一组正则映射成人话（`docker.ts:573-623`）：

| 原始错误特征 | 归类 | 给用户的建议 |
|---|---|---|
| `no space left on device` | 卷/磁盘 | 清盘或换 `WOC_DATA_ROOT` |
| `toomanyrequests` / `rate limit` | pull | 换镜像前缀或先手动拉 |
| `manifest unknown` / `pull access denied` | pull | 版本 tag 不存在，检查 `WOC_VERSION` |
| `e.stalled` | pull | N 分钟无进度，检查网络/DNS |
| `minimum memory limit` | create | 内存上限设太小 |
| `network .* not found` | create | 网络被删，重启面板重建 |

失败原因写进 `Instance.createError`，**面板重启后不会无解释地自动重试**（`index.ts:2045-2062`）：注释解释了为什么——重试多半又要拉镜像，会把面板开始监听拖上几分钟，期间整个面板打不开。

### 7）异步 provisioning

`startProvision` 维护 `provisioning` Map，先写 `PENDING_CREATE` 占位再后台 `runInstance`，前端轮询 `provisionView` 拿 `creating(pulling/container)` / `failed`（`index.ts:518-556`）。一键升级同理（`index.ts:906-956`），并且顺序被写死为「先 pull 再判 outdated 再逐个重建」，否则每个实例各拉一次镜像。

## 数据卷：编排里最容易出人命的部分

容器的创建与销毁可以随便重来，卷不行。WOC 在卷上做对了四件事，每一件都对应一次真实损失。

### 1）绑定型具名卷：让数据落在宿主看得见的地方

`WOC_DATA_ROOT` 允许把实例数据放到宿主绝对路径。实现不是简单的 bind mount，而是**用 local 驱动建一个「绑定型具名卷」**（`docker.ts:678-700`）：

```text
Driver: 'local'
DriverOpts: { type: 'none', o: 'bind', device: '<宿主目录>' }
```

这样卷仍然是「具名卷」，`docker volume ls` 看得见、能备份、能删；但实际数据在宿主目录里，用户可以直接用 NAS 的文件管理器打开。注释强调：**已有卷绝不改动**，只在卷不存在时创建——否则升级面板会把用户的挂载方式改掉。

配套的删除逻辑也必须改：普通卷 `removeVolume` 就完事，绑定型卷删完之后数据还在宿主目录里（`docker.ts:704-720`），所以要再用一个 root 辅助容器把宿主目录挂到 `/woc-root` 并 `rm -rf`。不做这一步，「删除实例并清数据」会变成谎言。

### 2）路径安全：两套白名单，因为一个拼进 shell

| 函数 | 拒绝什么 | 为什么 |
|---|---|---|
| `safeName` | `/`、`\0`、`.`、`..`，长度 ≤255 字节 | 文件名会进 docker API 的路径参数（`docker.ts:1827-1833`） |
| `safeMediaName` | 额外拒绝 `'"$\`\\;&\|<>` 与换行 | 这些名字会拼进 `sh -c` 命令串，必须防注入（`docker.ts:1838-1840`） |
| `safeVolPath` | `..`、NUL，剥离前导 `/` | 卷内相对路径（`docker.ts:2292-2302`） |

三个函数看着重复，其实边界不同：一个防路径穿越，一个防 shell 注入。合成一个反而会漏。

### 3）流式：内存必须常数

两条路径都被重写过：

- **上传**：`putFileStream` 先写 `/config/.woc-upload/` 下的临时名，成功后 `mv -fT` 原子改名（`docker.ts:1842-1902`）。注释记录了旧行为——中途断开会在正式文件名下留半截文件，用户以为传成功了。
- **下载**：`streamRegularFile` 先 `stat -c '%F|%s'` 只放行普通文件（不跟随符号链接），再 `docker exec cat` 并**自己拆 8 字节多路复用帧**，下游写不动时 `raw.pause()`、`drain` 后恢复（`docker.ts:1941-1982`）。注释：此前整个 tar 读进内存，峰值约文件的 2 倍，NAS 上极易 OOM。

### 4）校验：先走一遍，再写进去

整卷恢复前 `volCheckArchive` 会把整个包走一遍，只读头部、跳过数据（`docker.ts:2371-2398`）：

- `sniffArchive` 认出 zip 直接拒（只支持 tar/tar.gz）；
- 任何条目含 `..` 段（**包括符号链接目标**）→ 拒；
- 字符设备 / 块设备 / FIFO（type `3`/`4`/`6`）→ 拒；
- restore 模式要求所有条目都在 `config/` 下；
- 顶层条目超过 200 个 → 不给预览（避免列表爆炸）。

解压后还要 `chown -R -h abc:abc`（`docker.ts:2402-2435`）——NAS 上 root 打的包解出来是 root 所有，应用以 `abc` 运行就写不了，迁移来的微信库直接打不开。唯一例外是 `.woc-machine-id` 保持 root，因为它要被 init 钩子写回 `/etc/machine-id`。

## 代码证据

1. `panel/server/src/store.ts:340-361` — id / 容器名 / 卷名 / Kasm 凭据的唯一生成点，含 hex 密码的原因注释。
2. `panel/server/src/docker.ts:738-763` — 每实例串行锁 + 先备镜像后删容器。
3. `panel/server/src/docker.ts:771-821` — 完整 HostConfig：卷、网络、seccomp、SHM、日志、内存、设备、MAC/Hostname。
4. `panel/server/src/docker.ts:165-247` — mountinfo 自我识别 + 接入实例专用网络（`GwPriority:-1`）。
5. `panel/server/src/docker.ts:251-261` — `isFromInstanceNetwork` CIDR 判定并排除网关。
6. `panel/server/src/docker.ts:554-629` — ProvisionError 四阶段与正则映射。
7. `panel/server/src/index.ts:518-556` — 异步创建、`PENDING_CREATE` 占位、状态视图。
8. `panel/server/src/index.ts:756-773` — 删除默认保留数据卷，创建中返回 409。

## 复杂度与性能边界

| 维度 | 现状 | 边界 |
|---|---|---|
| 代码量 | `docker.ts` 2702 行、`index.ts` 2192 行 | 单文件过大，改一处要读很久 |
| 并发 | 每实例串行、实例间并行 | 没有全局调度器；几十个实例同时升级会打满 Docker 与出口带宽 |
| 拉镜像 | 停滞判定 `max(2, WOC_PULL_STALL_MIN=5)` 分钟（`docker.ts:1465`） | 计时从发请求就开始，因为守护进程连上源却拿不到清单时一个字节都不回（#129 实测旧版挂 8 分钟无报错） |
| 层进度 | 只有「层状态或字节数真的变了」才重置超时（`docker.ts:1511-1521`） | Docker 29 containerd 存储下载僵住时仍每 0.1s 重发不变字节，不这样判会永远不超时 |
| 卷操作 | 压缩包先校验再写入；`volBusy` 每实例同时只一件（`index.ts:1397-1442`） | 大卷备份占面板磁盘；整卷恢复要停实例 |
| 容器开销 | 每实例 1GiB `/dev/shm`（`docker.ts:74`） | tmpfs 按需占用，但上限是硬预留 |
| 恢复 | `keepImage` 重建 | 单机 Docker；宿主挂了就全挂，无跨机迁移 |

## 取舍与局限

- **只支持单机 Docker**：没有 Swarm/K8s，实例不能跨节点调度。这是刻意的——目标用户是 NAS。
- **docker.sock = 宿主 root**：面板被攻破等于宿主被攻破（`doc/安全加固.md:11-27`）。socket-proxy 只按端点过滤，`POST` 与 `EXEC` 一开仍可 create privileged / 挂载任意目录 / 注入命令（`doc/安全加固.md:57-63`）。
- **实例隔离不是安全隔离**：`seccomp=unconfined` 是为让 Chromium/微信能跑（`docker.ts:777`），容器共享内核。
- **删除卷不可逆**：`purge=1` 直接删；绑定型卷还会再进辅助容器 `rm -rf` 宿主目录（`docker.ts:704-720`），没有回收站。
- **创建失败不自动重试**：代价是用户必须手动点「重试创建」。

## 我能偷什么

1. **「先备镜像，再删旧容器」**——所有有状态容器重建都适用，顺序就是正确性。
2. **`withLifecycle` 按实例加锁**——比全局锁并发好，比分布式锁便宜两个数量级。
3. **id 派生全部资源名**——容器 / 卷 / 网络由同一个短 id 生成，删除和恢复都不会认错；反解 id 让「换容器不换卷」成为显式能力。
4. **错误分阶段 + 人话建议**——比抛原始 Docker 错误多写 30 行，支持成本降一个量级。
5. **恢复操作一律 `keepImage`**——把「重启」和「升级」彻底分开，避免「我什么都没动它怎么坏了」。

## 一句话记住

单机编排的可靠性不靠框架，靠四个顺序：**先锁实例、先备镜像、后删容器、恢复不换版**。
