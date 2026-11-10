# 04 深挖：KasmVNC 反代、单连接接管与输入桥

> 这篇回答什么问题：浏览器里的「微信桌面」是怎么被代理出来的？为什么同一实例只能有一个页面在显示？KasmVNC 卡死时系统怎么知道、怎么自愈？中文输入为什么要绕一圈走容器剪贴板？

## 问题

远程桌面不是普通 HTTP：一个页面要同时跑静态资源、长轮询音频，以及一条全双工 WebSocket。WOC 还要在这条链路上叠五件事：

1. **鉴权**：只有被授权的面板用户能连；
2. **凭据隐藏**：KasmVNC 的 Basic 密码不能进浏览器；
3. **单写者**：同一实例同一时间只允许一个页面「持有」桌面；
4. **故障恢复**：KasmVNC 卡死时不能只显示「连接中」转圈；
5. **输入正确性**：中文、粘贴、功能键必须按顺序、按意图送进容器。

## 朴素做法为什么不够

| 朴素做法 | 失败模式 | 项目里的证据 |
|---|---|---|
| 直接把 KasmVNC 的 3000/3001 暴露给浏览器 | 凭据进前端；实例可被绕过面板访问 | 实例只 Expose 不 Publish（`docker.ts:806-815`）；凭据服务端注入（`index.ts:1789-1796`） |
| `-AlwaysShared` 允许多连接 | EncCache 只在 ≥2 连接时启用且泄漏；两条 ws 并存会把 Xvnc 卡死 | `docker/Dockerfile:138-141`（KasmVNC#371：两条连接滚动 1 分钟 88→260 MiB） |
| 用 HTTP 静态页做健康检查 | 卡死时静态页照常 200，探针永远绿 | `index.ts:1738-1746` 注释；`doc/dev/稳定性设计.md`（`kill -STOP` 实测静态页 20ms 返回） |
| 断线让 noVNC 页内软重连 | 新旧两条 ws 短暂并存，概率性卡死 Xvnc | `doc/dev/稳定性设计.md`（该 bug 修过 4 次：`13ec0bd→b0511f5`） |
| 502 返回纯文本 | iframe 认为「已加载」，用户卡在黑屏死页 | `index.ts:1837-1853` 的自动重连页 |
| 让 Xvnc 自己同步 `image/png` 剪贴板 | 超过约 1MB 走 INCR 分段，Xvnc 从不收完 → 应用读剪贴板挂死 | `docker/Dockerfile:125-137`；`docker.ts:2186-2194` 实测 1,040,000 正常 / 1,060,000 必卡 |

## 核心机制

### 1）反代链路

```text
浏览器 → 面板 /desktop/:id/* → http-proxy → 实例 nginx:3000 → websockify → Xvnc :1
```

面板用单个 `httpProxy.createProxyServer({changeOrigin:true, ws:true})`（`index.ts:1703`），target 与凭据逐请求指定：`desktopHandler` 把 `_wocAuth=basicAuth(inst)` 挂到 `req` 上，`proxyReq` / `proxyReqWs` 时读出来注入 `Authorization`（`index.ts:1789-1796`）。

`proxyRes` 里删掉上游的 `www-authenticate`，避免浏览器弹原生 Basic 登录框（`index.ts:1829-1831`）。

### 2）WebSocket 四道闸门

raw upgrade 不经过 Fastify 的 `onRequest`，所以单独实现（`index.ts:1947-2035`）：

1. 来源不是实例专用网络；
2. Host 头在白名单；
3. `parseDesktopUrl` 能解析（`/^\/desktop\/([0-9a-f]{6,})(\/.*|\?.*|)?$/`）；
4. cookie 会话有效、用户未被禁用、`userCanAccess` 通过。

拒绝原因被分成四种人话（未携带 cookie / 会话过期 / 用户禁用 / 无权访问），并用 `wsRejectThrottled` 做「同实例同原因 60 秒只记一次、上限 200 条」的留痕（`index.ts:1932-1943`）——旧版静默 `destroy` 导致 issue #124 完全无法定位。

### 3）单连接与「接管」

每个页面整页加载时生成 viewer 标识（前端 12 字节 `crypto.getRandomValues` 转 hex，不用 `randomUUID` 因为它只在 HTTPS 下可用，`api.ts:243-246`）。

新页面连上时 `attachViewer`：

- 把旧页面记进 `supersededViewers`（`by: 用户名（设备）`）；
- `destroy()` 旧页面的所有 socket；
- 把 `controlHolders` 直接转给新页面（否则新页面要等旧页面心跳过期才能操作）；
- 写一条 `[vnc]` 实例日志（`index.ts:1122-1141`）。

被接管页面的自动重连在 upgrade 阶段直接 `socket.end('HTTP/1.1 409 Conflict…')`（`index.ts:1999-2014`），前端盖「在这里继续使用」，只有用户点击才整页重载、以新标识抢回。

实例内 Xvnc 同时带 `-NeverShared`（`Dockerfile:138-148`），旧镜像也能靠面板这层保持单连接。

### 4）控制权软锁

显示权与操作权分开：`CONTROL_TTL=10_000`ms（`index.ts:1040`），`/control/beat` 每 2.5 秒续约（前端节流），`/control/take` 主动申请。

输入类接口（`/type`、`/key`、`/paste-text`、`/paste-image`）都过 `claimControl`（`index.ts:1149-1158`）：别人持锁且未过期 → 409 `controlBusy`；自己被接管 → 409 `superseded`。

注释明确写了这是「协作上的防打架，不是用户之间的安全边界」——有访问权限的人本就能直接操作桌面。这句话很重要：不要把它当权限系统。

### 5）卡死识别与自愈

判据是「真实用户请求 25 秒内既没回 101、也没回任何响应」：

| 常量 | 值 | 位置 |
|---|---|---|
| `UPSTREAM_HANG_MS` | 25 000 | `index.ts:1738` |
| `STUCK_HANGS` | 2 次 | `index.ts:1739` |
| `STUCK_WINDOW_MS` | 10 分钟 | `index.ts:1740` |
| `STUCK_MIN_UPTIME_SEC` | 180 秒 | `index.ts:1741` |
| `STUCK_HEAL_COOLDOWN_MS` | 15 分钟 | `index.ts:1742` |

快速失败（502/ECONNREFUSED）不计数，只计真正的 hang。四个条件全部满足才 `runInstance(inst, {keepImage:true})`。`WOC_STUCK_HEAL=0` 可关。

页面侧拿到的是每 3 秒自动重载、最多 10 次（约 30 秒）的自动重连页，之后转手动重试（`index.ts:1837-1853`），而不是让 iframe 卡死。

### 6）连接生命周期

- 面板 → 实例的 TCP 套接字 `setKeepAlive(true, 30_000)`（`index.ts:1820-1826`）；
- 客户端 socket 一断，上游 proxy socket 跟着 `destroy()`（`index.ts:1809`）——注释解释了原因：`http-proxy` 不会关上游，Xvnc 会以为旧连接还在，形成幽灵会话；
- 客户端侧同样开 30 秒 keepalive（`index.ts:2027`）。

### 7）输入桥：为什么中文要走剪贴板

VNC 的键盘协议走 keysym，中文靠 IME 合成。逐字符差分发送会丢字，且 keysym 有容量上限。WOC 的方案是**两条腿**：

**镜像侧**（`docker/woc-www-patch.sh:1-30`，perl 改 KasmVNC 1.5.x 的 `assets/ui-*.js`，每处必须恰好命中 1 次否则 `die`）：

1. `initSetting("enable_ime",!1)` → `!0`：默认开 IME 输入模式；
2. `_handleCompositionUpdate` 在合成中只记 `_lastKeyboardInput` 并 return；
3. `_handleInput` 在合成中或 `inputType` 含 Composition 时 return（不按 keysym 实时发）；
4. `await x[i].getType(y)` 后加 `.catch(()=>null)`（KasmVNC#373：`getType()` 抛错会变致命浮层）。

**面板侧**：`typeInInstance` 把文本 base64 传进容器 → `xclip -i` 写容器剪贴板 → `xdoKey('ctrl+v')`（`docker.ts:2136-2158`）。上限 500 字符，前端按 500 切片（`Desktop.tsx:38-41`）。

两个细节值得单独记：

- `xdoKey` 生成的是 `xdotool keyup --delay 0 <所有修饰键> key <key>`，而不是 `--clearmodifiers`——后者会用 XTEST 把 Ctrl 按回去，导致粘完图再打中文发出一个「v」（`docker.ts:2042-2057`）；`--delay 0` 把松开耗时从 159ms 降到约 2.5ms（#155）。
- `xclip` 会 daemon 化常驻并继承 fd，不重定向 stdout/stderr 时 `docker exec` 要等约 2 秒；重定向后从 2.1s 降到 0.08s（`docker.ts:2148-2155`）。

**剪贴板借用/归还**：`CLIP_DIR=/tmp/.woc-clip`、`CLIP_RESTORE_MS=1000`（`docker.ts:2075-2076`）。只存一种格式（image/png > text/uri-list > UTF8_STRING），**超过约 1,000,000 字节既不保存也不归还**（走 INCR 会让 xclip 卡死，应用读剪贴板就挂住）；归还前还要确认剪贴板内容仍是我们放的那份（`docker.ts:2085-2101`）。

**前端粘贴桥**（`Desktop.tsx:211-313`）：捕获 Ctrl/Cmd+V 时只 `stopImmediatePropagation()`、**不** `preventDefault()`，让浏览器照常派发 paste；`e.repeat` 直接吞掉（#159 粘两张 / 一串 v）；用 `PASTE_EVENT_WAIT_MS=400` 与 `LATE_PASTE_MS=2000` 区分「本机剪贴板是新的」还是「这是我们刚写进去的回声」。

## 代码证据

1. `panel/server/src/index.ts:1703` + `1789-1816` — 单 proxy 实例、HTTP/WS 注入 Basic、101 日志、客户端断开联动销毁上游。
2. `panel/server/src/index.ts:1738-1787` — 25s / 2 次 / 10 分钟 / 3 分钟 / 15 分钟的自愈参数与条件链。
3. `panel/server/src/index.ts:1947-2035` — WS 四道闸门、viewer 参数剥离、superseded 409、`proxy.ws`。
4. `panel/server/src/index.ts:1092-1141` — viewer / superseded / 控制权转移。
5. `panel/server/src/index.ts:1837-1873` — 自动重连页与代理错误处理（只对 `accept: text/html` 返回该页）。
6. `docker/Dockerfile:124-148` — `-DLP_ClipTypes text/html`、`-AlwaysShared → -NeverShared`、构建期 grep 断言。
7. `docker/woc-www-patch.sh:1-30` — KasmVNC web 客户端四处补丁与「必须恰好命中一次」。
8. `panel/server/src/docker.ts:2186-2258` — PNG 1MB 上限、`instanceAcceptsLargePng` 能力探测、粘贴后 TARGETS 确认。
9. `panel/web/src/pages/Desktop.tsx:27-179` — 无感输入队列（composition / beforeinput / 按键排序）。
10. `panel/web/src/pages/Desktop.tsx:211-393` — 粘贴桥与 `navigator.clipboard` 包装。

## 复杂度与性能边界

| 维度 | 数值/行为 | 边界 |
|---|---|---|
| 卡死判定延迟 | 25s | 用户要等 25 秒才看到「自动重连」页 |
| 自愈阈值 | 10 分钟 2 次、冷却 15 分钟 | 低频卡死不会自动重启，只能手动 |
| 自动重连 | 3s × 10 次（约 30s） | 实例升级超过 30s 就转手动 |
| EncCache 泄漏 | 两条连接滚动 1 分钟 88→260 MiB | 单连接规避；代价是多端只能「接管」不能同屏 |
| Xvnc 长跑泄漏 | 24h 可达约 9 GiB（README 资源表口径） | watchdog soft 1500MB / hard 2500MB 兜底 |
| 文本输入 | 每次 ≤500 字符，一次 exec | 长文本走 `/paste-text`（≤200k） |
| 图片粘贴 | PNG ≤1MB（老实例）/ 原图（新实例） | 前端压到 900KB 预算再发（`pasteImage.ts:1-17`） |
| 剪贴板归还 | 1 秒后、且内容仍是我们的 | 超过约 1MB 直接放弃归还 |
| 反代吞吐 | 流式，不缓冲帧 | 主要成本是网络带宽与 TLS 终结 |

## 取舍与局限

- **单点是 Xvnc 本身**：进程内卡死无法恢复，只能重启容器。卡死根因至今未坐实——项目压测 100~150 次一组、各种异常断开均未复现，只有 `kill -STOP` 冻结 Xvnc 能稳定复现「静态页 20ms 返回、ws 升级无响应」（`doc/dev/稳定性设计.md`）。所以做的是「检测 + 重启」，不是「修复」。
- **单连接牺牲「同时观看」**：两个人不能同屏看同一实例，只能一个看、另一个被接管。对「多人协作」是硬限制。
- **面板多一跳**：反代故障/网络抖动直接表现为黑屏；换来凭据隐藏和统一鉴权。
- **KasmVNC 被钉死在 1.5.2**：baseimage 自 2025-07 停更（项目注释记录 linuxserver 已转向 Selkies），1.5.2 仍有已知 EncCache bug；升级要重新验证四处补丁的特征串（`Dockerfile:64-72`、`woc-www-patch.sh:21-28`）。
- **输入桥是双份实现**：镜像侧补丁 + 面板侧剪贴板注入，任一侧单独失效都会退化成「能打字但顺序乱」或「中文重复上屏」。
- **图片粘贴依赖前端压缩**：Safari canvas 上限约 16.7M 像素，超大截图会被缩到 900KB 预算内，画质有损（`pasteImage.ts:1-17`）。

## 我能偷什么

1. **单写者 lease + viewer id**：比锁 IP 更稳，换网络、换标签页都能正确接管；被接管方绝不自动抢回。
2. **用真实请求判活**：不要另起一套健康检查，直接在反代层给上游挂「无响应计时器」，并把快速失败与无应答分开计数。
3. **502 自动重连页**：任何 iframe 型远程桌面都适用，避免黑屏死页；次数有限、之后转手动，防止无限重连。
4. **客户端断开 → 上游销毁**：反代层必须显式处理，否则幽灵会话会拖垮上游。
5. **构建期补丁特征串校验**：补丁失配直接构建失败，绝不静默失效。
6. **「借用剪贴板」的归还协议**：写入前保存、写入后 1 秒还原、还原前校验内容仍是自己写的——这是把「共享可变全局状态」用出事务语义的最小做法。

## 一句话记住

远程桌面的稳定不是「连得上」，而是**只有一个写者、断了能识别、卡了能重启、重启不换版**——而输入的正确性，最终取决于你敢不敢绕开键盘协议。
