# 04 深挖：KasmVNC 反向代理与 WebSocket 单连接

> 这篇回答什么问题：浏览器里的「微信桌面」是怎么被代理出来的？为什么同一实例只能有一个页面在显示？KasmVNC 卡死时系统怎么知道并自愈？

## 问题

远程桌面不是普通 HTTP：一个页面要同时跑静态资源、长轮询音频、以及一条全双工的 WebSocket。WOC 还要在这条链路上叠四件事：

- 鉴权：只有被授权的面板用户能连；
- 凭据隐藏：KasmVNC 的 Basic 密码不能进浏览器；
- 单写者：同一实例同一时间只允许一个页面「持有」桌面；
- 故障恢复：KasmVNC 卡死时不能只显示「连接中」转圈。

## 朴素做法为什么不够

| 朴素做法 | 失败模式 | 项目里的证据 |
|---|---|---|
| 直接把 KasmVNC 的 3000/3001 暴露给浏览器 | 凭据进前端；实例可被绕过面板访问 | 实例只 Expose 不 Publish（`panel/server/src/docker.ts:813`），凭据服务端注入（`panel/server/src/index.ts:1789-1795`） |
| `-AlwaysShared` 允许多连接 | KasmVNC EncCache 只在 ≥2 连接启用且泄漏；两条 ws 并存会把 Xvnc 卡死 | `docker/Dockerfile:138-141` |
| 用 HTTP 静态页做健康检查 | 卡死时静态页照常返回 200，检查永远绿 | `panel/server/src/index.ts:1730-1733` |
| 断线让 noVNC 页内软重连 | 新旧两条 ws 短暂并存，概率性卡死 Xvnc | `doc/dev/稳定性设计.md:17` |
| 502 返回纯文本 | iframe 认为「已加载」，用户卡在黑屏死页 | `doc/dev/稳定性设计.md:18` |

## 这个项目怎么做

### 1）反代链路

浏览器 → 面板 `/desktop/:id/*` → `http-proxy` → 实例 `nginx:3000` → websockify → Xvnc。面板在 `proxyReq`/`proxyReqWs` 里注入 `Authorization: Basic`（`panel/server/src/index.ts:1789-1798`），并剥掉上游 401 的 `WWW-Authenticate`，避免浏览器弹原生登录框（`panel/server/src/index.ts:1827-1831`）。

### 2）WebSocket 三道闸门

raw upgrade 不经过 Fastify 的 `onRequest`，所以单独实现：

1. 来源不是实例专用网络（`panel/server/src/index.ts:1960-1962`）；
2. Host 头在白名单（`panel/server/src/index.ts:1964-1974`）；
3. cookie 会话 + `userCanAccess`（`panel/server/src/index.ts:1979-1995`）。

三道闸门都必须留日志——旧版静默 `destroy` 导致 issue #124 无法定位（`panel/server/src/index.ts:1948-1959` 注释）。

### 3）单连接与「接管」

每个页面整页加载时生成 viewer 标识。新页面连上时 `attachViewer` 把旧页面记为 superseded 并 `destroy` 旧 socket（`panel/server/src/index.ts:1122-1141`）。被接管页面的自动重连会被 409 拒绝（`panel/server/src/index.ts:2000-2013`），前端盖「在这里继续使用」，只有用户点击才整页重载、以新标识抢回。

实例内 Xvnc 同时用 `-NeverShared`（`docker/Dockerfile:143-148`），旧镜像也能靠面板这层保持单连接。

### 4）卡死识别与自愈

判据是「真实用户请求 25 秒内既没回 101、也没回任何响应」：快速失败（502/ECONNREFUSED）不计数，只计真正的 hang（`panel/server/src/index.ts:1738-1746`）。10 分钟内累计 2 次、实例已运行满 3 分钟、15 分钟冷却外，才 `runInstance(inst, { keepImage: true })`（`panel/server/src/index.ts:1748-1773`）。

页面请求超时会返回一个每 3 秒自动重载、最多 10 次的「自动重连页」（`panel/server/src/index.ts:1837-1853`），而不是让 iframe 卡死。

### 5）连接生命周期

面板→实例的 TCP 套接字开启 30 秒 keepalive（`panel/server/src/index.ts:1817-1826`）；客户端 socket 一断，上游 proxy socket 跟着 `destroy`（`panel/server/src/index.ts:1806-1809`）——否则实例里的 Xvnc 会以为旧连接还在，形成幽灵会话。

### 6）输入与中文

镜像构建期给 KasmVNC web 客户端打补丁：默认开 IME、合成中不逐字符发送、`getType()` 异常不弹致命浮层（`docker/Dockerfile:115-122`）。面板侧 `/type` 用「容器剪贴板 + Ctrl+V」绕开 keysym 上限（`panel/server/src/docker.ts:2136-2158`），前端粘贴桥在 `panel/web/src/pages/Desktop.tsx:182-308`。

## 代码证据（8 条）

1. `docker/Dockerfile:124-148` — 去掉 PNG 剪贴板 INCR、`-NeverShared`、启动脚本特征串校验。
2. `panel/server/src/index.ts:1789-1816` — HTTP/WS 注入 Basic + 101 日志 + 客户端断开联动销毁上游。
3. `panel/server/src/index.ts:1738-1773` — 25s/2 次/10 分钟/3 分钟/15 分钟的自愈参数与实现。
4. `panel/server/src/index.ts:1947-2036` — WS 三道闸门、viewer 参数剥离、superseded 409、`proxy.ws`。
5. `panel/server/src/index.ts:1085-1141` — 单连接 viewer 管理。
6. `panel/server/src/index.ts:1837-1873` — 自动重连页与代理错误处理。
7. `panel/web/src/pages/Desktop.tsx:182-308` — 无感输入/粘贴桥。
8. `docker/Dockerfile:115-122` — KasmVNC web 客户端补丁的构建期注入。

## 复杂度与性能边界

| 维度 | 数值/行为 | 边界 |
|---|---|---|
| 卡死判定延迟 | 25s | 用户要等 25 秒才看到「自动重连」页 |
| 自愈阈值 | 10 分钟 2 次、冷却 15 分钟 | 低频卡死不会自动重启，只能手动 |
| 自动重连 | 3s × 10 次 | 实例升级超过 30s 就转手动 |
| EncCache 泄漏 | 2 连接滚动 1 分钟 88→260MiB（`docker/Dockerfile:139-140`） | 单连接规避，但多端协作只能「接管」不能同屏 |
| Xvnc 长跑泄漏 | 24h 可达 ~9GiB（`doc/dev/稳定性设计.md:20`） | watchdog soft 1500MB/hard 2500MB 兜底 |
| 剪贴板 | 只同步 `text/html`，不同步 PNG（`docker/Dockerfile:134-135`） | 图片走面板粘贴桥，依赖前端 |

## 取舍与局限

- **单点是 Xvnc 本身**：进程内卡死无法恢复，只能重启容器（`doc/dev/稳定性设计.md:46-48`）。换 WebRTC/Selkies 能根治，但收益不抵风险，暂不做。
- **单连接牺牲了「同时观看」**：两个人不能同时看同一实例；只能一个看、另一个被接管。对「多人协作」是硬限制。
- **面板多一跳**：反代故障/网络抖动直接表现为黑屏；但换来凭据隐藏和统一鉴权。
- **KasmVNC 版本被钉死**：1.5.2 有已知 EncCache bug，升级要重新验证补丁特征串（`docker/Dockerfile:120-122`）。
- **卡死根因仍未坐实**：项目做了大量压测仍未复现（`doc/dev/稳定性设计.md:50`），所以只能做「检测+重启」，不是「修复」。

## 我能偷什么

1. **单写者 lease + viewer id**：比锁 IP 更稳，换网络/换标签页都能正确接管。
2. **用真实请求判活**：不要用独立健康检查猜，直接用用户正在走的请求；快速失败与无应答分开计数。
3. **502 自动重连页**：任何 iframe 型远程桌面都适用，避免黑屏死页。
4. **客户端断开 → 上游销毁**：反代层必须显式处理，否则幽灵会话会拖垮上游。
5. **构建期补丁特征串校验**：补丁失配直接构建失败，绝不静默失效。

## 一句话记住

远程桌面的稳定不是「连得上」，而是**只有一个写者、断了能识别、卡了能重启、重启不换版**。
