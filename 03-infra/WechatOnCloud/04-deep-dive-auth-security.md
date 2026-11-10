# 04 深挖：认证、RBAC 与安全边界

> 这篇回答什么问题：面板是唯一入口，它怎么证明「你是谁、你能看哪个实例」？一个挂着 docker.sock 的系统凭什么还能谈安全？边界到底画在哪，哪里其实没画？

## 问题

WOC 的安全模型有一个残酷前提：**能登录面板的人，就能看到被授权的微信会话，并以你的身份发消息**；而面板本身挂着宿主 `docker.sock`，等于宿主 root。所以它必须回答四个问题：

1. 怎么认证用户，且会话在面板重启后不丢；
2. 怎么授权到「实例」粒度，且不泄露上游凭据；
3. 怎么防止浏览器被 DNS rebinding 借道攻击内网面板；
4. 怎么让 KasmVNC 的 Basic 密码永远不出现在前端。

## 朴素做法为什么不够

| 朴素做法 | 失败模式 | 项目里的对策 |
|---|---|---|
| 只设一个管理员密码 | 无法给家人/同事分配不同实例；共享密码无法追责 | admin + sub 双角色 + `allowedInstances`（`store.ts:304-313`） |
| JWT 放 localStorage | XSS 直接偷 token；无法服务端踢人 | httpOnly cookie + 服务端会话表（`index.ts:326-333`、`sessions.ts:55-79`） |
| 会话只存内存 | 面板一重启全员掉线（issue #95「记住密码没生效」） | `sessions.json` 持久化 + 滑动续期（`sessions.ts:17-79`） |
| 只校验 Host 是内网 IP | 攻击者域名解析到 192.168.x.x，浏览器视为同源，自动带 cookie | 白名单 + 私网/CGNAT 判定（`host-guard.ts:35-111`） |
| 信任 `X-Forwarded-Host` | 该头浏览器脚本也能伪造，DNS rebinding 借它绕过白名单 | Host 是外部域名时**一律不看 XFH**（`host-guard.ts:121-139`） |
| 把 KasmVNC 密码写进 iframe URL | 浏览器历史 / 开发者工具 / 反代日志全泄漏 | 服务端注入 Basic（`index.ts:1789-1796`） |
| 登录限速只按 IP | 反代后所有用户共用一个 IP，一人输错锁全部 | 双键 + 反代兜底键（`index.ts:245-334`） |
| 实例与面板同网络 | 实例被攻破后可访问面板 API 与其他容器 | 专用网络 + 按网段拒绝（`docker.ts:251-261`、`index.ts:150-155`） |

## 核心机制

### 1）账号模型：管理员 + 子账号，双向授权

`User` 有 `role: 'admin'|'sub'`、`allowedInstances: string[]`、`disabled`、`mustChangePassword`（`store.ts:8-23`）。

`userInstances`：admin 拿全量，sub 按白名单过滤；`userCanAccess`：admin 只要求实例存在，sub 要求 id 在白名单且实例存在（`store.ts:304-313`）。

授权可以从两侧改：改实例的 `instanceUsers` 或改用户的 `allowedInstances`，最终写同一份数据（`store.ts:418-443`）。删除实例会同步从所有用户的白名单里移除，避免留下悬空 id。

### 2）密码与登录限速

密码用 bcrypt（cost 10）哈希（`store.ts:99`、`191-193`）。首次启动若无 admin，用 `PANEL_ADMIN_USER||'admin'` / `PANEL_ADMIN_PASSWORD||'wechat'` 建号并标 `mustChangePassword`（`store.ts:117-124`）。

登录限速是纯内存 Map，三档（`index.ts:245-334`）：

| 键 | 阈值 | 目的 |
|---|---|---|
| `ip:<src>` | 20 次 / 15 分钟 | 单来源防撞库 |
| `u:<src>|<username>` | 5 次 / 15 分钟 | 单账号防爆破 |
| `peer:<socket 对端>` | 100 次 / 15 分钟 | 反代后所有人共用一个 IP 时的兜底，避免一人锁全体 |

`loginSource` 的实现值得单独看（`index.ts:261-288`）：默认用 socket 对端地址；只有对端是回环或命中 `trustedProxies()`（Docker 网段 + `WOC_TRUSTED_PROXIES`，60 秒缓存）时，才从 `X-Forwarded-For` 取**最右**一段——最右是最近一跳写的，取最左会被客户端伪造。

成功登录会 `loginFails.delete(key)` 清账，再 `createSession` + 写 cookie（`index.ts:326-333`）。

### 3）会话：httpOnly cookie + 持久化 + 滑动续期

- token 是 32 字节随机 hex（`sessions.ts:55-60`）；
- 存 `dirname(PANEL_DATA)/sessions.json`，500ms 防抖写、权限 0600（`sessions.ts:33-51`）；
- TTL 默认 30 天（`WOC_SESSION_DAYS`，最小 1，`sessions.ts:12-13`）；
- 剩余不足一半即续满并置 `slid` 标记（`sessions.ts:71-79`），`requireAuth` 发现 `slid` 时重设 cookie 的 maxAge（`index.ts:194-214`）；
- 改密码、重置密码、禁用、删除用户都会 `destroyUserSessions`，改密码时保留当前会话（`index.ts:393-403`、`438-490`）。

### 4）Host 白名单：防 DNS rebinding

`host-guard.ts` 只有 140 行，但它是整个系统的第一道门。

默认白名单（`host-guard.ts:35-61`）：

- loopback：`localhost` / `127.0.0.1` / `[::1]` / `::1`；
- RFC1918：`10/8`、`172.16/12`、`192.168/16`；
- 链路本地 `169.254/16`；
- **CGNAT `100.64/10`**——这条是为 Tailscale / Headscale 加的，很实用；
- IPv6：`fc00::/7` ULA（含 Tailscale 的 `fd7a:115c:a1e0::/48`）与 `fe80::/10`。

`PANEL_ALLOWED_HOSTS` 支持逗号分隔、`*.example.com` 通配（不匹配裸域）（`host-guard.ts:87-111`）。

**最关键的一段**（`host-guard.ts:121-139`）：

```text
Host 在白名单 → 放行
Host 是外部多段域名 → 一律不看 X-Forwarded-Host，直接拒
只有 Host 是「反代连面板的内部地址」时，才看 XFH 的第一段
```

注释记录了学费：曾因「Host 或 XFH 任一命中即放行」，被实测用默认账号登录并调用管理接口。这是典型的「加了兼容反而开了洞」。

拒绝时回 400 并回显 `host` / `forwardedHost` / `hint`（`index.ts:160-174`），hint 里明确说「要加的是面板收到的 Host，改完用 `docker compose up -d` 重建容器（不是 restart）使其生效」——因为 env 只在创建容器时注入。

### 5）网络边界：实例碰不到面板

面板建 `woc-instances` 网络，自己以 `GwPriority:-1` 接入（不抢默认网关），实例只接这个网络（`docker.ts:222-247`）。

`isFromInstanceNetwork(addr)` 用 CIDR 位运算判断，并**排除网关**——因为经宿主转发进来的请求源地址就是网关，不排除会把正常访问也拒了（`docker.ts:251-261`）。

面板 `onRequest` 第一道钩子直接 403 来自实例网段的请求（`index.ts:150-155`），并带 `connection: close`。

实例容器不映射任何宿主端口（`docker.ts:806-815` 只 Expose 3000）。

### 6）KasmVNC 凭据：服务端注入，永不下发

- 实例记录里存 `kasmUser` / `kasmPassword`，注释写明「服务端注入反代，永不下发前端」（`store.ts:50-51`）；
- `publicInstance` 只返回 id / name / appType / icon / createdAt / createdBy / 内存阈值（`store.ts:257-268`）——**连 containerName 和 volumeName 都不给**；
- `/api/instances` 的注释记录了修复原因：「此前直接展开整条记录，连 kasm 凭据都带给了浏览器」（`index.ts:494-511`）；
- 反代时 `proxyReq` / `proxyReqWs` 注入 `Authorization: Basic`，并删掉上游的 `www-authenticate`（`index.ts:1789-1796`、`1829-1831`）。

### 7）docker.sock 的真实风险

默认 compose 直接挂 `/var/run/docker.sock`（`docker-compose.yml:58-63`），注释自己写着「等同宿主 root，实例增删仅限管理员，docker API 绝不暴露前端」。

加固版插 `tecnativa/docker-socket-proxy`（`docker-compose.secure.yml:12-45`）：

| 开关 | 值 | 含义 |
|---|---|---|
| CONTAINERS / EXEC / IMAGES / VOLUMES / POST / INFO / NETWORKS | 1 | 面板工作必需 |
| BUILD / COMMIT / SWARM / SERVICES / SECRETS / PLUGINS / NODES / AUTH / CONFIGS / SYSTEM | 0 | 显式关闭 |

面板改连 `tcp://docker-socket-proxy:2375`，并用 `/dev/null:/var/run/docker.sock` 覆盖裸 socket（`docker-compose.secure.yml:50-55`）；代理只在 `internal: true` 的 `woc_proxy` 网络里，不映射端口。

但文档诚实说明残余风险（`doc/安全加固.md:57-63`）：代理**按端点不按请求体**过滤，`POST=1` 仍可 create privileged 容器、挂载任意宿主目录；`EXEC=1` 仍可进容器注入命令。socket-proxy 是「缩小攻击面」，不是「隔离」。

## 威胁模型：谁可能打你，能打到什么

把攻击面按「谁能进来」分成四层，比按功能列更清楚。

| 层 | 攻击者位置 | 能做什么 | 现有防线 | 残余风险 |
|---|---|---|---|---|
| L1 | 公网任意人 | 扫端口、撞库、试默认口令 | Host 白名单默认拒外部域名；登录三键限速；默认口令标 `mustChangePassword` | 端口若被反代暴露，只有密码一道关；无 MFA |
| L2 | 内网其他设备 | 直接访问 `NAS_IP:36080` | RFC1918 默认放行（内网即信任）；会话 cookie | **内网默认无认证门槛之外的隔离**，同网段可撞库 |
| L3 | 已登录的普通用户 | 调用面板 API、操作被授权实例 | `requireAuth` + `userCanAccess`；`requireAdmin` 挡住全部管理路由 | 同一实例的所有授权用户共享同一微信，可互相窥视 |
| L4 | 实例容器内（应用被攻破） | 尝试访问面板与其他容器 | 专用网络 + 面板 403 该网段 + 不映射宿主端口 | 容器共享内核、`seccomp=unconfined`；同网络实例之间**可互访** |
| L5 | 面板进程被攻破 | 通过 docker.sock 控制宿主 | 默认无；加固版 socket-proxy 按端点过滤 | **等同宿主 root**，socket-proxy 也挡不住恶意 create/exec |

L4 里那句「同网络实例之间可互访」值得单独说：实例都接在 `woc-instances` 上，面板只拒绝了「实例 → 面板」，没有拒绝「实例 A → 实例 B」。推断：这是刻意的取舍——多一层网络分段会让每个实例各占一个网络，编排复杂度显著上升，而威胁模型里「实例被攻破」已经意味着攻击者拿到了你的微信。`待查实`：是否有文档讨论过这一点。

## 代码证据

1. `panel/server/src/store.ts:191-193` — bcrypt 校验。
2. `panel/server/src/store.ts:304-313` — `userInstances` / `userCanAccess` 的 RBAC 核心。
3. `panel/server/src/store.ts:257-268` — `publicInstance` 字段白名单。
4. `panel/server/src/sessions.ts:55-79` — 随机会话 id、持久化、滑动续期。
5. `panel/server/src/index.ts:245-334` — 三键限速、可信 XFF 最右段解析、cookie 写入。
6. `panel/server/src/index.ts:194-238` — `requireAuth` / `requireAdmin`。
7. `panel/server/src/host-guard.ts:115-139` — `isInternalUpstreamHost` + 「外部域名不看 XFH」。
8. `panel/server/src/index.ts:150-155` — 拒绝实例网段。
9. `panel/server/src/docker.ts:251-261` — CIDR 判定并排除网关。
10. `panel/server/src/store.ts:50-51` + `index.ts:1789-1796` — 凭据只在服务端。

## 复杂度与性能边界

| 维度 | 现状 | 边界/风险 |
|---|---|---|
| 密码哈希 | `bcrypt.compareSync` 同步 | 登录并发高时阻塞事件循环；限速缓解，但没异步化 |
| 会话存储 | 单个 `sessions.json`，500ms 防抖写 | 不支持多进程/多副本；文件损坏会全员掉线 |
| 限速 | 内存 Map，超 1000 条清过期 | 面板重启归零；多副本不共享 |
| Host 校验 | 纯函数，O(白名单条数) | 配置错误直接 400，靠响应回显排错 |
| 网络隔离 | Docker bridge + 网段判定 | 同宿主 root 仍可打穿；不是对抗性多租户 |
| TLS | 不在面板内 | 必须外层反代（`README.md:192`） |
| 会话续期 | 剩余 <50% 才写 | 高频访问下写放大有限 |

## 取舍与局限

- **没有 MFA / 陌生设备验证 / 审计日志**：README 路线图里仍是未完成项（`README.md:207-220`）。对公网暴露是硬伤。
- **默认口令 `admin` / `wechat`**：不改就是裸奔；`.env.example` 与 README 都反复提醒，`mustChangePassword` 只是提示不是强制拦截（`store.ts:117-124`）。
- **子账号 ≠ 隔离**：同一实例的所有授权用户共享同一个微信会话，互相看得见操作。
- **SameSite=Lax 不是 CSRF 万能药**：GET 顶级导航仍会带 cookie；当前 API 以 JSON/POST 为主，风险可控，但没有显式 CSRF token。
- **控制权软锁不是权限**：`claimControl` 只防「两人同时操作打架」，注释自己写明「不是用户之间的安全边界」（`index.ts:1143-1148`）。
- **socket-proxy 不是银弹**：如上，端点级过滤挡不住恶意 create/exec。
- **会话文件是单点**：面板数据目录丢失 = 所有账号与实例登记丢失（容器和卷还在，可以用「复用卷」重建）。
- **离线找回是后门**：编辑 `accounts.json` 加 `resetPassword:true`，重启面板即重置为初始口令并解禁（`store.ts:133-145`）。这对忘记密码是救命，对有文件写权限的攻击者是提权——不过能改 `accounts.json` 的人本来就有宿主权限。

## 我能偷什么

1. **Host 白名单 + 私网判定 + 「外部域名不看 XFH」**：任何自部署面板都该有，代码不到 150 行，`host-guard.ts` 可以直接抄结构。
2. **三键限速（IP + 用户名 + 反代对端兜底）**：既防撞库又避免反代后一人锁全体，这个「兜底键」的思路很少见。
3. **服务端凭据注入 + 上游 401 头剥离**：把上游密码留在服务端，前端只拿会话 cookie；顺手删 `www-authenticate` 防浏览器弹框。
4. **拒绝实例网段请求 + 排除网关**：比「实例不要攻击我」的自觉可靠得多；排除网关这个细节是踩过坑才知道的。
5. **会话持久化 + 滑动续期 + 改密踢其他端**：NAS 用户经常重启面板，掉登录体验极差；而改密必须踢人。
6. **`publicInstance` 字段白名单**：不要「返回整条记录再删敏感字段」，而是「只挑要给的字段」——前者一次重构就会漏。

## 一句话记住

WOC 的安全不是「容器隔离」，而是**一个门卫 + 一把网络锁 + 一条服务端凭据**；门卫之外（docker.sock）仍是宿主 root，这是它必须明说、也只能明说的边界。
