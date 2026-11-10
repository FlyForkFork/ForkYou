# 05 性能：内存是主战场，CPU 不是

> 这篇回答什么问题：一个实例到底吃多少资源？面板的热路径在哪？哪些常量决定了容量上限？什么时候会突然变慢，以及为什么优化重点不是 CPU？

## 先给结论

WOC 的瓶颈是**内存**，不是 CPU。空闲实例约 0.6 GiB，活跃 1–1.5 GiB；CPU 多数时间 0.1–0.2 核，操作时短时突发到 1 核（`README.md:164-178`，8 核 / 8 GiB 宿主实测，实例均已登录微信并含 Chromium 内核的 WeChatAppEx）。

真正的风险不是计算量，而是 **Xvnc 长跑泄漏**与**磁盘被无界写入吃光**，两者都用常量兜住。

## 实测基线

| 状态 | CPU | 内存（RSS） | 证据 |
|---|---|---|---|
| 单实例 · 空闲（已登录、无人观看） | ~0.1–0.2 核 | ~0.6 GiB | `README.md:170` |
| 单实例 · 活跃（有人在浏览器操作 / 刷消息） | ~0.5–1 核（可突发） | ~1–1.5 GiB | `README.md:171` |
| 面板本身 | 可忽略 | ~0.12 GiB | `README.md:172` |
| 每实例 `/dev/shm` | — | 预留 1 GiB（tmpfs，按需占用） | `README.md:174`；`docker.ts:74` |

容量参考（`README.md:175-178`）：2 核 / 2 GiB 跑 1 个实例（轻度）；4 核 / 8 GiB 跑 3–4 个；视频通话等重负载另加预留。

> 以上是**项目自述的实测**，没有压测脚本、没有吞吐/延迟基准。并发用户数、WebSocket 帧率、端到端输入延迟都没有量化数据——标 `待查实`。

## 一次「打开桌面」的开销拆解

把冷启动拆开看，才能判断慢在哪一层（数值来自代码常量与 README 自述，标 `待查实` 的为未实测）：

| 阶段 | 开销 | 来源 |
|---|---|---|
| 面板反代到静态页 | 一次 HTTP + 一次 Docker 网络跳转 | `index.ts:1886-1906` |
| 实例 nginx 返回 noVNC 页 | 静态文件，毫秒级 | `docker.ts:2698-2700` |
| WebSocket 建链 | 四道校验 + `attachViewer` + `proxy.ws` | `index.ts:1947-2035` |
| Xvnc 首帧 | 取决于桌面复杂度与编码，`待查实` | — |
| 文本上屏 | 一次 `docker exec` + `xclip` + `xdotool`；重定向后约 0.08s | `docker.ts:2148-2155` |
| 图片粘贴 | putArchive + xclip + 最多 20 次 TARGETS 探测（`timeout 2`） | `docker.ts:2223-2258` |
| 实例冷创建 | 拉镜像（数百 MB）+ 建卷 + 建容器 | `docker.ts:751-841` |

文本输入的 0.08s 是项目自己测过的数字（注释里写了「从 ~2.1s 降到 ~0.08s」），它是这条链路里唯一有明确量化的一条。**其余端到端延迟都没有基准数据**。

## 热路径在哪

| 路径 | 频率 | 成本 | 证据 |
|---|---|---|---|
| `/websockify` WebSocket | 持续，画面帧 | 网络带宽 + 反代转发；`http-proxy` 流式，不整帧缓冲 | `index.ts:1796-1816` |
| `/desktop/:id/vnc/index.html` | 每次打开 | 一次 HTTP 反代 + 静态页 | `index.ts:1789-1795` |
| 文本输入 `/type` | 每次上屏（按 500 字切片） | 一次 `docker exec` + 两次 xclip + 一次 xdotool | `docker.ts:2136-2158` |
| 图片粘贴 `/paste-image` | 每次粘贴 | 一次 putArchive + xclip + 一次 TARGETS 确认循环 | `docker.ts:2223-2258` |
| 实例列表 `/api/instances` | 状态轮询；只在有 `BUSY` 相位时 1.5s 一次 | 纯内存 + 每实例一次 Docker 状态读取 | `AppShell.tsx:28-47`；`index.ts:494-511` |
| 看门狗 | 默认 300s 一次 | 每实例一次 `docker stats` 类内存读取 | `index.ts:2083-2174` |
| 面板内存读数 | 同上看门狗 | 读 `usage - inactive_file`（等同 `docker stats`） | `docker.ts:1097-1110` |

没有数据库、没有消息队列、没有前端组件库运行时。绝大部分代码是「路由 + Docker API 调用 + 反代」。

## 决定容量上限的常量

| 常量 | 值 | 位置 | 影响 |
|---|---|---|---|
| `SHM_SIZE` | 1 GiB | `docker.ts:74` | 每实例 tmpfs 上限；微信 CEF 必需 |
| soft 内存阈值 | 1500 MiB | `index.ts:2083` | 无活跃会话时超限才重启 |
| hard 内存阈值 | 2500 MiB | `index.ts:2084-2087` | 无视会话强制重启，防 OOM |
| watchdog 间隔 | 300s（最小 60） | `index.ts:2088` | 巡检频率 |
| 实例内存上限 | `WOC_INSTANCE_MEM_GB`（默认 0=不设） | `docker.ts:89-90`、`784-787` | 容器级 OOM 兜底，`Memory` 与 `MemorySwap` 同值禁 swap |
| 容器日志 | 20m × 2 | `docker.ts:780-782` | 每实例最多 40 MB |
| 面板日志 | 单文件 512KB、保留 365 天 | `logs.ts:12-14` | 防止日志吃盘 |
| 上传上限 | 4 GiB / 20 GiB / 100 GiB | `index.ts:217-219` | 文件中转 / 卷文件 / 压缩包 |
| 上传 spool 预留 | 256 MiB | `upload.ts`（`SPOOL_RESERVE`） | 剩余空间不足直接 507 |
| 拉镜像停滞 | 默认 5 分钟（最小 2） | `docker.ts:1465` | 慢速但持续不算停滞 |
| 崩溃转储读取 | 16 MiB / 最多解析 5 个 / 最多列 20 个 | `docker.ts:1544-1547` | 防诊断包撑爆内存 |
| 卡死判定 | 25s / 2 次 / 10 分钟 / 3 分钟 / 15 分钟冷却 | `index.ts:1738-1742` | 只影响体验，不影响吞吐 |
| 控制权 TTL | 10s | `index.ts:1040` | 心跳 2.5s 节流 |
| 图片粘贴上限 | 1,000,000 字节 PNG | `docker.ts:2195` | 前端预算 900,000（`pasteImage.ts:1-17`） |

## 已知的内存泄漏与兜底

| 泄漏源 | 量级 | 兜底 |
|---|---|---|
| KasmVNC EncCache（≥2 连接时启用） | 两条连接滚动 1 分钟 88→260 MiB（KasmVNC#371） | 强制单连接（`Dockerfile:138-141`） |
| Xvnc 长跑 | 项目称 24h 可达约 9 GiB | watchdog soft/hard 重启（`index.ts:2141-2158`） |
| Chromium 崩溃转储 | 无上限会堆积 | 1 天 TTL（`docker/autostart:186-189`） |
| Chromium 指标文件 | 曾膨胀到数百 GiB | 启动参数关 metrics + `cleanup_chromium_metrics`（`app-defs.sh:18-24`、`autostart:50-56`） |
| Docker 日志 | 默认无上限 | 面板与实例都 20m×2 |
| 面板上传 | 旧版整文件读内存：400MB 文件涨约 1.2GB，3GB 整卷恢复峰值十几 GB | 流式 spool（`upload.ts:1-7`） |
| 卷下载 | 旧版把整个 tar 读进内存，峰值约文件 2 倍 | `streamRegularFile` 自己拆多路复用帧 + 背压（`docker.ts:1941-1982`） |

## 复杂度

- 反代 WebSocket：O(字节数)，`http-proxy` 直接管道转发，不解析帧。
- 实例列表：O(实例数)，每实例一次状态读取；几十个实例仍可接受。
- 看门狗：O(实例数)，300s 一次；内存读取是主要开销。
- 会话查找：O(会话数) 的 JSON 内存表；NAS 规模（几十用户）足够。
- 卷操作：O(文件数)，`find -maxdepth 1 -printf`（`docker.ts:2313-2335`）；大目录会慢但有限。
- 诊断包：O(实例数 × 日志行数)，构建在内存里再落盘（`docker.ts:1537-1539`），实例多时峰值明显。

## 优化建议（按收益排序）

1. **先加内存，不要加 CPU**：4 核 / 8 GiB 比 8 核 / 4 GiB 能多跑实例。
2. **把 `WOC_DATA_ROOT` 指到大容量盘**：卷和微信数据不占系统盘（`.env.example`）。
3. **按实例调 soft/hard**：活跃实例常在 1.5 GiB 左右，soft 设 2000 更稳；hard 必须低于宿主可用内存（`index.ts:1205` 附近的前端提示也给了同样建议）。
4. **不要开 GPU**：WSL2 / 虚拟 GPU 下 `-hw3d` 会让 Xvnc 内存持续膨胀（`.env.example` 中 `WOC_ENABLE_GPU` 的说明记录了「21 小时涨到约 9GB」）。
5. **`WOC_INSTANCE_MEM_GB` 是 OOM 兜底，不是容量规划**：设得比宿主余量还大等于没设。
6. **诊断包别在实例多的时候全量导出**：内存构建 + 大量 exec，会短暂抢占实例 CPU。

## 反例：这些「优化」不该做

- **把 watchdog 间隔调小**：内存泄漏是小时级现象，60s 巡检只会增加 `docker stats` 开销与误杀概率。
- **打开 VNC 响应性探测**：`WOC_WATCHDOG_HEALTH_FAILS` 默认 0 是刻意的——宿主 CPU/IO 争用会让探测失败，从而误杀正常实例（`index.ts:2159-2174`）。
- **给实例加 CPU 限额**：容器本来不设硬性 CPU 上限，空闲省、活跃突发；加 limit 只会让画面卡顿而不省总电。
- **把 `bcrypt` 换成更快算法**：登录不是热路径，安全优先。真正该做的是异步化（`compareSync` 会阻塞事件循环，`store.ts:191-193`）。

## 诚实边界

- 只有 README 的一组 8 核 / 8 GiB 实测；**没有压测脚本、没有吞吐/延迟基准**，并发用户数、WebSocket 帧率、输入延迟都没有量化数据，标 `待查实`。
- 面板事件循环会被 `bcrypt.compareSync` 阻塞（`store.ts:191-193`），登录风暴下会拖慢所有请求；限速降低了概率，但没有异步化。
- 单机 Docker，没有横向扩展；容量上限就是宿主内存。
- 「24h 涨到 9 GiB」是项目自述，未给出复现命令与采样方式，标 `待查实`。

## 一句话记住

WOC 的容量公式：**面板 0.15 GiB + 每实例 1–1.5 GiB + 1 GiB SHM 预留**；性能优化 90% 是在管内存和磁盘边界，不是在管代码。
