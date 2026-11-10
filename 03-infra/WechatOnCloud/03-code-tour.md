# 03 代码走读：从 `docker compose up` 到看见微信窗口

> 这篇回答什么问题：这个仓库该从哪几个文件读起？一次「打开实例」到底经过哪些函数？想加一个功能应该改哪几处？测试怎么跑？

## 目录树（只列关键）

```text
WechatOnCloud/                      94 个文件（git ls-files）
├── docker-compose.yml              面板部署入口（唯一对外服务）
├── docker-compose.secure.yml       overlay：加 docker-socket-proxy
├── .env.example                    全部环境变量与解释（159 行）
├── docker/                         实例镜像
│   ├── Dockerfile                  178 行：baseimage-kasmvnc + 锚定 Chromium/KasmVNC
│   ├── autostart                   205 行：openbox 会话启动、壁纸/字体看守、应用拉起
│   ├── app-defs.sh                 49 行：各应用的 APP_BIN/APP_LAUNCH
│   ├── app-ctl.sh                  241 行：统一 install/update/status（微信/QQ/Telegram/custom）
│   ├── wechat-ctl.sh               252 行：微信下载/校验/解压/原子切换
│   ├── woc-identity.sh             60 行：machine-id + OS 伪装
│   ├── woc-www-patch.sh            30 行：KasmVNC web 客户端 IME 补丁
│   ├── woc-app-init.sh             25 行：写 /config/.woc-app
│   └── woc-update-autostart        14 行：每次启动覆盖数据卷里的 autostart
├── panel/
│   ├── Dockerfile                  27 行：两阶段 node:22-slim
│   ├── server/src/
│   │   ├── index.ts                2192 行：路由 + 反代 + WS + watchdog
│   │   ├── docker.ts               2702 行：dockerode 封装 + 生命周期 + exec
│   │   ├── store.ts                459 行：账号/实例持久化
│   │   ├── sessions.ts             96 行：会话
│   │   ├── host-guard.ts           140 行：DNS rebinding 防护
│   │   ├── self-update.ts          282 行：面板自更新
│   │   ├── upload.ts               188 行：流式上传
│   │   ├── tar.ts                  299 行：手写 tar 编解码
│   │   ├── crash-diag.ts           436 行：minidump 元数据解析
│   │   ├── logs.ts                 128 行：面板/实例日志
│   │   └── version.ts              124 行：版本检查
│   └── web/src/
│       ├── pages/Admin.tsx         2180 行：管理页
│       ├── pages/Desktop.tsx       1960 行：桌面页 + 输入桥 + 粘贴桥
│       ├── AppShell.tsx            579 行：外壳与实例轮询
│       ├── api.ts                  510 行：HTTP 封装
│       ├── pasteImage.ts           151 行：图片压缩降级
│       └── vncAudio.ts             300 行：音频通道
├── fnos/                           飞牛 .fpk 工程（待真机验证）
├── doc/                            技术方案、运行原理、部署、安全加固
├── doc/dev/                        架构守则、稳定性设计、发布门禁、P0 复盘
└── scripts/                        build-local.sh、bump-chromium.py
```

## 构建入口

| 目标 | 入口 | 关键点 |
|---|---|---|
| 面板镜像 | `panel/Dockerfile:1-27` | 两阶段 `node:22-slim`；web `npm ci && npm run build`（含图标生成），server 用 `tsx` 直跑 TS，无编译产物 |
| 实例镜像 | `docker/Dockerfile:4-178` | 基座 `lscr.io/linuxserver/baseimage-kasmvnc:debianbookworm`；Chromium 快照、KasmVNC 版本全部 ARG 锚定 |
| 本地一键 | `scripts/build-local.sh:1-42` | 打 `woc-panel:<tag>` 与 `wechat-on-cloud:<tag>`；必须 `--provenance=false --sbom=false` |
| CI 发布 | `.github/workflows/release.yml:1-217` | 4 个「镜像 × 架构」原生 runner 构建，按 digest 推 GHCR，merge job 合成多架构并复制 Docker Hub |

实例镜像**不在构建期装微信**（`docker/Dockerfile:6-8`），这是镜像小的原因，也是首次使用必须联网的原因。

## 主流程走读

### 1. 面板启动

`index.ts:2039-2070`：`waitForDocker()`（最多 30s，socket-proxy 加固部署下代理可能比面板晚几秒就绪）→ `resolveInstanceImage()`（版本 tag 兜底）→ `ensureNetwork()` → 遍历实例 `ensureRunning()` → `checkInstanceNetworks()` 体检 → `watchInstanceNetwork()` 每 2 分钟复查 → 30s 后 `pruneOldWocImages()`。`listen` 在 `index.ts:2186-2192`，之后 `startUpdateChecker()` 与每日 `pruneOldLogs()`。

`ensureRunning` 只在容器 404 时才重建（`docker.ts:845-861`）——Docker 一时连不上不会被当成「容器不存在」。

### 2. 登录

`POST /api/auth/login`（`index.ts:326-334`）：先过登录限速（`index.ts:245-334`，双键 `ip:` 20 次/15min、`u:<ip>|<username>` 5 次/15min，反代后另加 `peer:` 100 次/15min 兜底），`verifyPassword` 用 bcrypt（`store.ts:191-193`），成功后 `createSession`（`sessions.ts:55-60`）并写 httpOnly cookie（`index.ts:326-333`）。会话默认 30 天、剩余不足一半自动续满（`sessions.ts:12-13`、`71-79`）。

### 3. 新建实例

`POST /api/admin/instances`（`index.ts:598-627`）校验名称 ≤30、`appType` 在白名单、复用卷名必须匹配 `/^woc-data-[0-9a-zA-Z._-]{1,64}$/` 且未被占用（409）→ `startProvision`（`index.ts:523-543`）先写 `PENDING_CREATE` 占位再后台 `runInstance` → 前端轮询 `provisionView`（`index.ts:544-556`）。

创建是**异步**的：立即返回。`#129` 的根因就是旧版同步等待被反代 60 秒掐断（`index.ts:518-525` 注释）。

`runInstanceNow`（`docker.ts:751-841`）顺序固定：`ensureImage` → 快照旧日志 → 删旧容器 → `ensureInstanceVolume` → `createContainer` → `start`；start 失败要 `container.remove({force:true})`，否则会留一个幽灵容器占着卷名（`docker.ts:832-841`）。

### 4. 打开桌面

`desktopHandler`（`index.ts:1886-1906`）做四件事：未登录 302 `/login`；`userCanAccess` 失败 403；`reply.hijack()` 后改写 `req.raw.url`；挂 `_wocAuth=basicAuth(inst)` 与 `_wocInstId`，然后 `proxy.web(target=instanceTarget(inst))`。

WebSocket 升级走独立路径（`index.ts:1947-2035`），因为 raw upgrade 不经过 Fastify 的 `onRequest`，必须重新做 Host / 会话 / 权限 / superseded 四道判定。

### 5. 输入

| 通道 | 入口 | 实现 |
|---|---|---|
| 文本（≤500 字） | `index.ts:1161-1176` | `typeInInstance`：base64 传文本 → `xclip -i` → `xdotool` Ctrl+V（`docker.ts:2136-2158`） |
| 大文本（≤200k 字） | `index.ts:1213-1228` | `pasteTextInInstance`：`putArchive` 到 `/tmp` 再 xclip（`docker.ts:2160-2174`） |
| 图片 | `index.ts:1180-1209` | `pasteImageInInstance`，PNG 有 1MB 硬上限（`docker.ts:2186-2258`） |
| 按键 | `index.ts:1230-1245` | `keyInInstance`，正则白名单防注入（`docker.ts:2264-2283`） |
| 前端无感输入 | — | `installSeamlessIme`（`Desktop.tsx:27-179`） |
| 前端粘贴桥 | — | `installPasteBridge`（`Desktop.tsx:211-313`）+ `installClipboardGuard`（`351-393`） |

## 先读这 10 个文件

| 顺序 | 文件 | 为什么先读 |
|---|---|---|
| 1 | `README.md` | 定位、特性、资源估算、安全须知 |
| 2 | `doc/dev/架构守则.md` | 10 条不变式全是 P0 学费，读代码前先读 |
| 3 | `docker-compose.yml` | 看清面板挂了什么、暴露什么 |
| 4 | `docker/Dockerfile` | 实例镜像的真面目：KasmVNC 补丁与运行参数 |
| 5 | `panel/server/src/store.ts` | 数据模型：User / Instance / AppType |
| 6 | `panel/server/src/docker.ts` | 容器生命周期与所有 exec 操作 |
| 7 | `panel/server/src/index.ts` | 全部路由与反代主流程 |
| 8 | `panel/server/src/host-guard.ts` | 安全边界第一道门（140 行，最容易读完） |
| 9 | `panel/server/src/sessions.ts` | 会话持久化与滑动续期（96 行） |
| 10 | `panel/web/src/pages/Desktop.tsx` | 桌面页的 iframe / 输入 / 音频状态机 |

## 关键类型与签名

```ts
// panel/server/src/store.ts:8-23
type Role = 'admin' | 'sub';
interface User { id; username; role: Role; passwordHash; disabled; createdAt; allowedInstances: string[]; mustChangePassword?; resetPassword? }

// panel/server/src/store.ts:29-30
type AppType = 'wechat' | 'telegram' | 'chromium' | 'qq' | 'custom';

// panel/server/src/store.ts:43-67
interface Instance {
  id: string; name: string; appType?: AppType;
  containerName: string;   // woc-wx-<id>
  volumeName: string;      // woc-data-<id>
  kasmUser: string;        // 永不下发前端
  kasmPassword: string;
  memSoftLimitMB?: number; memHardLimitMB?: number;
  createError?: string; createErrorHint?: string;
}

// panel/server/src/docker.ts:740-748
function runInstance(inst: Instance, opts?: { keepImage?: boolean }): Promise<void>;

// panel/server/src/docker.ts:880
function upgradeInstance(inst: Instance, opts?: { skipPull?: boolean }): Promise<void>;

// panel/server/src/docker.ts:2698-2700
function instanceTarget(inst: Instance): string; // http://<containerName>:3000

// panel/server/src/index.ts:194-214
function requireAuth(req, reply): Promise<User | null>;

// panel/server/src/index.ts:230-238
function requireAdmin(req: FastifyRequest, reply: FastifyReply): User | null;
```

## 加功能改哪里

| 想做什么 | 改这些地方 | 注意 |
|---|---|---|
| 新增一种应用类型 | `store.ts:29-30` 的 `AppType` 与 `APP_LABELS`；`docker/app-defs.sh:1-49`；`docker/app-ctl.sh` 的 install/status 分支；`docker/autostart:13-19`；`panel/web/src/api.ts` 的类型 | 旧镜像不认识新类型会回退微信；必须兼容旧面板 |
| 新增一个 API | `index.ts` 加路由 + `requireAuth`/`requireAdmin`；前端 `api.ts` | octet-stream 上传路由不受 bodyLimit 约束，必须自己限长（`index.ts:179` 注释） |
| 新增容器参数 | `docker.ts:484-508` 的 `envList` + `docker.ts:771-821` 的 HostConfig | 必须写进声明式 createOpts，不能靠克隆旧容器 |
| 实例数据迁移 | `store.ts:106-147` 的 `initStore` + `docker.ts:678-700` 的 `ensureInstanceVolume` | 必须幂等；已有卷绝不改动 |
| 改桌面行为 | `index.ts:1701-1906`（HTTP 反代）、`index.ts:1947-2035`（WS）、`Desktop.tsx` | iframe 的 effect 必须依赖 `frameGen`，否则换文档后监听丢失 |
| 改 UI | `panel/web/src/pages/*`、`parts.tsx`、`ui.tsx`、`styles.css` | 无组件库，全部手写 |

## 并发模型：一个事件循环，三种等待

面板是单进程 Node，所有并发都落在同一个事件循环上。读代码时必须分清三类操作，它们的阻塞后果完全不同：

| 类别 | 例子 | 是否阻塞事件循环 | 证据 |
|---|---|---|---|
| 异步 I/O | Docker API、文件读写、反代转发 | 否 | `docker.ts` 全部 `await`；`index.ts:1703` 的 `http-proxy` |
| 同步 CPU | `bcrypt.compareSync`、tar 头解析、minidump 解析 | **是** | `store.ts:191-193`、`tar.ts`、`crash-diag.ts` |
| 显式串行化 | `withLifecycle`（每实例）、`withClipLock`（每实例剪贴板）、`pullInFlight`（拉镜像合并） | 否（Promise 链） | `docker.ts:738-748`、`2105-2110`、`1428-1436` |

`bcrypt` 是唯一的明显同步热点：一次登录失败校验约几十毫秒，配合限速（20 次/15 分钟/IP）不会被放大；但如果将来放开限速或加多副本，必须先换成异步 API。

另一个容易忽略的点：`upgrade-all` 是**顺序执行**的（`index.ts:906-956`），不是并发。注释解释了原因——先 `pullImage` 一次，再逐个 `upgradeInstance({skipPull:true})`，否则 N 个实例会各拉一次同一个镜像。

## 错误留痕：为什么每处拒绝都要写日志

`index.ts:1947-1959` 有一段很长的注释，讲的是 issue #124：三道 WS 闸门早期一律 `socket.destroy()`，用户侧只看到「重连中」，面板和实例日志里一个字都没有，诊断包拿不到任何线索。

修法有两层：

1. 每条拒绝路径都调 `reject(reason)`，把原因写进**实例日志**（`[vnc] 连接被拒：…`）与**面板日志**；
2. `wsRejectThrottled(instId, reason)` 做同实例同原因 60 秒只记一次、上限 200 条（`index.ts:1932-1943`）——因为客户端每 2~4 秒重试一次，不限流 24 小时能刷出几万行。

同样的思路出现在 `print_status`（`wechat-ctl.sh:59-67`：状态文件说「安装中」但没有安装进程 → 改写成「上次安装被中断」）、`is_installer_pid`（`wechat-ctl.sh:78-85`：必须核对 `/proc/<pid>/cmdline`，否则容器内小 pid 复用会永久误判）。

这是一条可迁移的工程规则：**失败必须留下能定位的痕迹，且痕迹本身要有界**。

## 测试地图（诚实版）

**仓库没有单元测试、集成测试目录**，两个 `package.json` 都没有 `test` 脚本（`panel/server/package.json`、`panel/web/package.json`）。质量保障分四层：

| 层 | 做法 | 证据 |
|---|---|---|
| 类型检查 | server 与 web 各跑 `npx tsc --noEmit` | `doc/dev/发布门禁.md`（第 1 节） |
| 构建门禁 | web `npm run build`；实例镜像构建期校验 KasmVNC 补丁特征串（失配直接 fail） | `docker/Dockerfile:143-148` |
| 运行时探针 | 5 项：DPI 98304、裸 chromium 连跑两次各 7s、30s 无「已退出」、微信模式等到「尚未安装」、KasmVNC 参数与补丁标记 | `doc/dev/发布门禁.md`（第 2 节）；`.github/workflows/release.yml:74-103` |
| 升级路径 | 用上一 release 的容器 + 卷原地升级，人工点公众号 / 附件 | `doc/dev/发布门禁.md`（第 3 节） |

所以：**改代码至少跑 `npx tsc --noEmit`；碰实例镜像必须按发布门禁跑容器探针**。没有自动回归，是这个项目最大的工程债之一（见 07、08）。

## 一句话记住

先读 `架构守则` 再读 `index.ts`：这个项目的复杂度不在业务逻辑，而在**一条远程桌面链路和一条升级链路的失败模式**——代码里每一段奇怪的注释，背后都有一个线上事故。
