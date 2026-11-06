# 05 性能：内存是主战场，CPU 不是

> 这篇回答什么问题：一个实例到底吃多少资源？面板的热路径在哪？哪些常量决定了容量上限？什么时候会突然变慢？

## 先给结论

WOC 的性能瓶颈是**内存**，不是 CPU。空闲实例约 0.6GiB，活跃 1–1.5GiB；CPU 多数时间 0.1–0.2 核，操作时短时突发到 1 核（`README.md:166-176`）。真正的风险是 KasmVNC/Xvnc 长跑泄漏，不是计算量。

## 实测基线

| 状态 | CPU | 内存（RSS） | 证据 |
|---|---|---|---|
| 单实例 · 空闲（已登录、无人观看） | ~0.1–0.2 核 | ~0.6 GiB | `README.md:170` |
| 单实例 · 活跃（有人操作 / 刷消息） | ~0.5–1 核（可突发） | ~1–1.5 GiB | `README.md:171` |
| 面板本身 | 可忽略 | ~0.12 GiB | `README.md:172` |
| 每实例 `/dev/shm` | — | 预留 1 GiB（tmpfs 按需占用） | `README.md:174`；`panel/server/src/docker.ts:74` |

容量参考：2 核/2GiB 跑 1 个实例（轻度）；4 核/8GiB 跑 3–4 个；视频通话另加预留（`README.md:175-178`）。

## 热路径在哪

| 路径 | 频率 | 成本 | 证据 |
|---|---|---|---|
| `/websockify` WebSocket | 持续，画面帧 | 主要是网络带宽 + 反代转发；`http-proxy` 流式，不整帧缓冲 | `panel/server/src/index.ts:1796-1816` |
| `/desktop/:id/vnc/index.html` | 每次打开 | 一次 HTTP 反代 + 静态页 | `panel/server/src/index.ts:1789-1795` |
| 文本输入 `/type` | 每次上屏 | 一次 `docker exec` + 剪贴板操作 | `panel/server/src/docker.ts:2136-2158` |
| 实例列表 `/api/instances` | 页面轮询（约 1.5s） | 纯内存 + 少量 Docker 状态查询 | `panel/web/src/AppShell.tsx:42-46`；`panel/server/src/index.ts:494-511` |
| 看门狗 | 默认 300s 一次 | `docker stats` + 每实例一次 HTTP 探测 | `panel/server/src/index.ts:2072-2184` |

没有数据库、没有消息队列、没有前端组件库运行时。绝大部分代码是「路由 + Docker API 调用 + 反代」。

## 决定容量上限的常量

| 常量 | 值 | 位置 | 影响 |
|---|---|---|---|
| `SHM_SIZE` | 1GiB | `panel/server/src/docker.ts:74` | 每个实例的 tmpfs 上限；微信 CEF 必需 |
| soft 内存阈值 | 1500MiB | `panel/server/src/index.ts:2083` | 无活跃会话时超限重启 |
| hard 内存阈值 | 2500MiB | `panel/server/src/index.ts:2084-2087` | 无视会话重启，防 OOM |
| watchdog 间隔 | 300s（最小 60） | `panel/server/src/index.ts:2088` | 巡检频率 |
| 容器日志 | 20m × 2 | `panel/server/src/docker.ts:780-782` | 每实例最多 40MB 日志 |
| 面板日志 | 单文件 512KB、保留 365 天 | `panel/server/src/logs.ts:12-14` | 防止日志吃盘 |
| 上传上限 | 4GiB / 20GiB / 100GiB | `panel/server/src/index.ts:217-219` | 文件 / 卷文件 / 压缩包 |
| 上传 spool 预留 | 256MiB | `panel/server/src/upload.ts:114-115` | 剩余空间不足直接 507 |
| 拉镜像停滞 | 默认 5 分钟 | `panel/server/src/docker.ts:1465` | 慢速但持续不算停滞 |
| 诊断包单文件 | 16MB | `panel/server/src/docker.ts:1544-1547` | crashinfo 读取上限 |
| 卡死判定 | 25s / 2 次 / 10 分钟 | `panel/server/src/index.ts:1738-1742` | 只影响体验，不影响吞吐 |

## 已知的内存泄漏与兜底

| 泄漏源 | 量级 | 兜底 |
|---|---|---|
| KasmVNC EncCache（≥2 连接时启用） | 两连接滚动 1 分钟 88→260MiB | 强制单连接（`docker/Dockerfile:138-141`） |
| Xvnc 长跑 framebuffer/软渲染缓存 | 24h 可达 ~9GiB | watchdog soft/hard 重启（`doc/dev/稳定性设计.md:20`；`.env.example:132-157`） |
| Chromium 崩溃转储 | 无上限会堆积 | 1 天 TTL（`docker/autostart:182-189`） |
| Docker 日志 | 默认无上限 | 面板 20m×2，实例 20m×2 |
| 面板上传 | 旧版整文件读内存，400MB 涨 1.2GB | 流式 spool（`panel/server/src/upload.ts:1-7`） |

## 复杂度

- 反代 WebSocket：O(字节数)，`http-proxy` 直接管道转发，不解析帧。
- 实例列表：O(实例数)，每个实例一次 Docker inspect/状态读取；几十个实例仍可接受。
- 看门狗：O(实例数)，300s 一次；`docker stats` 是主要开销。
- 会话查找：O(会话数) 的 JSON 内存表；NAS 规模（几十用户）足够。

## 优化建议（按收益排序）

1. **先加内存，不要加 CPU**：4 核/8GiB 比 8 核/4GiB 更能多跑实例。
2. **把 `WOC_DATA_ROOT` 指到大容量盘**：卷和微信数据不占系统盘（`.env.example:93-102`）。
3. **按实例调 soft/hard**：活跃实例 1.5GiB 左右，soft 设 2000 更稳；hard 要低于宿主可用内存（`.env.example:154`）。
4. **不要开 GPU**：WSL2/虚拟 GPU 下 `-hw3d` 会让 Xvnc 内存持续膨胀（`.env.example:83-87`）。
5. **单个实例内存上限**：`WOC_INSTANCE_MEM_GB` 是容器级 OOM 兜底，不要设得比宿主余量还大（`.env.example:114-117`）。

## 诚实边界

- 以上只有 README 的一组 8 核/8GiB 实测；**没有压测脚本、没有吞吐/延迟基准**。并发用户数、WebSocket 帧率、输入延迟都没有量化数据，标 `待查实`。
- 面板事件循环会被 `bcrypt.compareSync` 阻塞（`panel/server/src/store.ts:191-193`），登录风暴下会拖慢所有请求；限速降低了概率，但没有异步化。
- 单机 Docker，没有横向扩展；容量上限就是宿主内存。

## 一句话记住

WOC 的容量公式：**面板 0.15GiB + 每实例 1–1.5GiB + 1GiB SHM 预留**；性能优化 90% 是在管内存，不是在管代码。
