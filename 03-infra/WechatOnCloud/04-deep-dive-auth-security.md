# 04 深挖：认证、RBAC 与安全边界

> 这篇回答什么问题：面板是唯一入口，它怎么证明「你是谁、你能看哪个实例」？为什么挂了 docker.sock 的系统还能谈安全？边界到底在哪？

## 问题

WOC 的安全模型有一个残酷前提：**能登录面板的人，就能看到面板里所有被授权的微信会话**；而面板本身挂着宿主 `docker.sock`，等于宿主 root。所以它必须回答四个问题：

1. 怎么认证用户，且会话在面板重启后不丢；
2. 怎么授权到「实例」粒度；
3. 怎么防止浏览器被 DNS rebinding 利用；
4. 怎么让 KasmVNC 凭据永远不出现在前端。

## 朴素做法为什么不够

| 朴素做法 | 失败模式 |
|---|---|
| 只设一个管理员密码 | 无法给家人/同事分配不同实例；共享密码无法追责 |
| JWT 放 localStorage | XSS 直接偷 token；无法滑动续期/服务端踢人 |
| 只校验 Host 是内网 IP | 攻击者域名解析到 192.168.x.x，浏览器视为同源，自动带 cookie（DNS rebinding） |
| 把 KasmVNC 密码写进 iframe URL | 浏览器历史/开发者工具/日志全泄漏 |
| 登录限速只按 IP | 反代后面所有用户共用一个 IP，一人输错锁全部 |
| 实例和面板同网络 | 实例被攻破后可访问面板 API 和其他容器 |

## 这个项目怎么做

### 1）账号模型：管理员 + 子账号，实例双向授权

`User` 有 `role: admin|sub`、`allowedInstances`；管理员隐式拥有全部实例，子账号按 `allowedInstances` 过滤（`panel/server/src/store.ts:304-313`）。授权可以从「实例」侧改 `instanceUsers`，也可以从「用户」侧改 `allowedInstances`，两边最终都写同一份数据（`panel/server/src/store.ts:431-443`、`panel/server/src/store.ts:195-228`）。

密码用 bcrypt 哈希（`panel/server/src/store.ts:191-193`），登录失败用「IP + 用户名」双键限速：同源同用户 15 分钟 5 次、同源 15 分钟 20 次（`panel/server/src/index.ts:241-301`）。

### 2）会话：httpOnly cookie + 持久化 + 滑动续期

会话 ID 是 32 字节随机 hex（`panel/server/src/sessions.ts:55-60`），存 `sessions.json`，面板重启后仍有效（`panel/server/src/sessions.ts:12-17`）。Cookie 设置 `httpOnly`、`sameSite=lax`、30 天（`panel/server/src/index.ts:327-332`）。剩余不足一半 TTL 时自动续满（`panel/server/src/sessions.ts:62-80`），改密码会踢掉其他会话（`panel/server/src/index.ts:393-403`）。

### 3）Host 白名单：防 DNS rebinding

`host-guard.ts` 先解析 Host（含端口/IPv6），默认放行 loopback 与 RFC1918 私网（10/8、172.16/12、192.168/16、169.254/16、100.64/10 CGNAT、fc00::/7、fe80::/10），再匹配 `PANEL_ALLOWED_HOSTS` 的显式域名/通配子域（`panel/server/src/host-guard.ts:21-111`）。

关键细节：**Host 是外部多段域名时，一律不看 `X-Forwarded-Host`**——这个头浏览器脚本也能伪造，DNS rebinding 会借它绕过白名单（`panel/server/src/host-guard.ts:124-140`）。

### 4）网络边界：实例碰不到面板

面板建 `woc-instances` 网络，自己接入但 `GwPriority=-1`，不抢默认网关（`panel/server/src/docker.ts:222-247`）。实例只接这个网络；面板的 `onRequest` 钩子直接拒绝来自实例网段的请求（`panel/server/src/index.ts:149-155`）。实例容器也没有宿主端口映射（`panel/server/src/docker.ts:813`）。

### 5）KasmVNC 凭据：服务端注入，永不下发

实例记录里存 `kasmUser/kasmPassword`，注释写明「服务端注入反代，永不下发前端」（`panel/server/src/store.ts:50-51`）；API 只返回 `publicInstance`，剔除这两个字段（`panel/server/src/store.ts:257-268`）。反代请求时由 `proxyReq` 注入 Basic（`panel/server/src/index.ts:1789-1795`）。

### 6）docker.sock 的真实风险

默认 compose 直接挂 `/var/run/docker.sock`（`docker-compose.yml:61-63`），文档明确「等同宿主 root」（`doc/安全加固.md:11-27`）。加固版插 `tecnativa/docker-socket-proxy`，只放行 CONTAINERS/EXEC/IMAGES/VOLUMES/POST/INFO/NETWORKS，拒绝 BUILD/COMMIT/SWARM/SERVICES/SECRETS/PLUGINS/NODES（`docker-compose.secure.yml:12-28`、`docker-compose.secure.yml:30-42`）。

但文档也诚实说明残余风险：代理**按端点不按请求体**过滤，仍可 create privileged 容器、挂载任意目录；`EXEC=1` 仍可进容器注入命令（`doc/安全加固.md:57-63`）。

## 代码证据（8 条）

1. `panel/server/src/store.ts:191-193` — bcrypt 校验密码。
2. `panel/server/src/store.ts:304-313` — `userInstances` / `userCanAccess` 的 RBAC 核心。
3. `panel/server/src/sessions.ts:55-80` — 随机会话 ID、持久化、滑动续期。
4. `panel/server/src/index.ts:241-301` — 双键登录限速与可信 XFF 解析。
5. `panel/server/src/index.ts:327-332` — httpOnly / SameSite=Lax / 30 天 cookie。
6. `panel/server/src/host-guard.ts:97-140` — Host 白名单与 DNS rebinding 防护。
7. `panel/server/src/index.ts:149-155` — 拒绝实例网段访问面板。
8. `panel/server/src/store.ts:50-51` + `panel/server/src/index.ts:1789-1795` — 凭据只在服务端。

## 复杂度与性能边界

| 维度 | 现状 | 边界/风险 |
|---|---|---|
| 密码哈希 | `bcrypt.compareSync` 同步 | 登录并发高时会阻塞事件循环；限速缓解，但没有异步化 |
| 会话存储 | 单个 `sessions.json`，500ms 防抖写 | 多进程/多副本不支持；文件损坏会全员掉线 |
| 限速 | 内存 Map | 面板重启归零；多副本不共享 |
| Host 校验 | 纯函数，O(域名数) | 配置错误直接 400，排错靠响应里回显的 host |
| 网络隔离 | Docker bridge | 同宿主 root 仍可打穿；不是对抗性多租户 |
| TLS | 不在面板内 | 必须外层反代；README 明确建议 `README.md:192` |

## 取舍与局限

- **没有 MFA / 二次验证 / 审计日志**：路线图里仍是未完成项（`README.md:217`）。对公网暴露是硬伤。
- **默认密码 admin / wechat：不改就是裸奔；`.env.example:3-5` 和 README 都反复提醒。
- **子账号≠隔离**：同一实例的所有授权用户共享同一个微信会话，互相能看到操作。
- **SameSite=Lax 不是 CSRF 万能药**：GET 顶级导航仍会带 cookie；当前 API 以 JSON/POST 为主，风险可控但未做显式 CSRF token。
- **socket-proxy 不是银弹**：如上，端点级过滤挡不住恶意 create/exec。
- **会话文件是单点**：面板数据目录丢失 = 所有账号和实例元数据丢失（卷还在）。

## 我能偷什么

1. **Host 白名单 + 私网判定**：任何自部署面板都该有，代码不到 150 行。
2. **双键限速（IP + 用户名）**：既防撞库又避免反代后一人锁全体。
3. **服务端凭据注入**：把上游密码留在服务端，前端只拿会话 cookie，是反代型产品的通用模式。
4. **拒绝实例网段请求**：比「实例不要攻击我」的自觉可靠得多，一行网段判断换一层边界。
5. **会话持久化 + 滑动续期**：NAS 用户经常重启面板，掉登录体验极差。

## 一句话记住

WOC 的安全不是「容器隔离」，而是**一个门卫 + 一把网络锁 + 一条服务端凭据**；门卫之外（docker.sock）仍是宿主 root，这是它必须明说的边界。
