# 03 代码走读：从 `docker compose up` 到看见微信窗口

> 这篇回答什么问题：这个仓库该从哪几个文件读起？一次「打开实例」到底经过哪些函数？想加功能应该改哪里？

## 目录树（只列关键）

```text
WechatOnCloud/
├── docker-compose.yml          # 面板部署入口（唯一对外服务）
├── docker-compose.secure.yml   # 加 docker-socket-proxy 的加固版
├── .env.example                # 全部环境变量与解释
├── docker/                     # 实例镜像
│   ├── Dockerfile              # linuxserver/kasmvnc 基座 + 锚定 Chromium/KasmVNC
│   ├── app-defs.sh             # 微信/QQ/Chromium/自定义 的启动定义
│   ├── app-ctl.sh              # 统一 install/update/status
│   ├── wechat-ctl.sh           # 微信下载/校验/解压/原子切换
│   ├── autostart               # openbox 会话启动：拉应用、壁纸、字体
│   └── woc-*.sh                # machine-id、应用类型、www 补丁
├── panel/
│   ├── server/src/
│   │   ├── index.ts            # Fastify 全部路由 + 反代 + WS + watchdog（2192 行）
│   │   ├── docker.ts           # dockerode 封装 + 生命周期（2702 行）
│   │   ├── store.ts            # 账号/实例持久化
│   │   ├── sessions.ts         # 会话
│   │   ├── host-guard.ts       # DNS rebinding 防护
│   │   ├── self-update.ts      # 面板自更新
│   │   ├── upload.ts / tar.ts  # 流式上传/打包
│   │   └── logs.ts / crash-diag.ts / version.ts
│   └── web/src/                # React SPA
│       ├── pages/Admin.tsx     # 管理页（2082 行）
│       ├── pages/Desktop.tsx   # 桌面页 + 输入桥（1876 行）
│       ├── api.ts / parts.tsx / ui.tsx
├── fnos/                       # 飞牛 .fpk 打包工程（未真机验证）
├── doc/                        # 技术方案、运行原理、部署、安全、dev 守则
└── scripts/build-local.sh      # 本地构建面板+实例镜像
```

## 构建入口

| 目标 | 入口 | 关键点 |
|---|---|---|
| 面板镜像 | `panel/Dockerfile:4-27` | 两阶段 node:22-slim；web `npm run build`（含图标生成），server `tsx src/index.ts` |
| 实例镜像 | `docker/Dockerfile:4-20` | 基座 `lscr.io/linuxserver/baseimage-kasmvnc:debianbookworm`；Chromium/KasmVNC 版本全部 ARG 锚定 |
| 本地一键 | `scripts/build-local.sh:11-42` | 打 `woc-panel:<tag>` 与 `wechat-on-cloud:<tag>`，compose 直接复用本地镜像 |
| CI 发布 | `.github/workflows/release.yml` | 每个「镜像×架构」在原生 runner 构建、按 digest 推 GHCR，最后 imagetools 合并多架构并复制 Docker Hub |

实例镜像不在构建期装微信：`docker/Dockerfile:6-8` 明确「运行时下载到 /config」。这是镜像小的原因，也是首次使用要联网的原因。

## 主流程走读

### 1. 面板启动

`panel/server/src/index.ts:2039-2070`：`waitForDocker()`（最多 30s）→ `resolveInstanceImage()` → `ensureNetwork()` → 遍历实例 `ensureRunning()` → 网络体检 → 30s 后清理旧镜像。最后 `listen` 在 `panel/server/src/index.ts:2186-2192`。

`ensureRunning` 只在容器 404 时才重建（`panel/server/src/docker.ts:847-862`）；Docker 一时连不上不会被当成「容器不存在」。

### 2. 登录

`POST /api/auth/login` 在 `panel/server/src/index.ts:302-334`：先过登录限速（`panel/server/src/index.ts:241-301`），`verifyPassword` 用 bcrypt（`panel/server/src/store.ts:191-193`），成功后 `createSession`（`panel/server/src/sessions.ts:55-60`）并写 httpOnly cookie（`panel/server/src/index.ts:327-332`）。会话默认 30 天、滑动续期（`panel/server/src/sessions.ts:12-13`、`panel/server/src/sessions.ts:62-80`）。

### 3. 新建实例

`POST /api/admin/instances`（`panel/server/src/index.ts:598-627`）→ `startProvision`（`panel/server/src/index.ts:518-556`）→ 后台 `runInstance`（`panel/server/src/docker.ts:746-842`）。创建是**异步**的：立即返回，前端轮询 provisioning 状态。`#129` 的根因是旧版同步等待被反代 60s 掐断（`panel/server/src/index.ts:518-525` 注释）。

`runInstanceNow` 的顺序很关键：先 `ensureImage`（必要时拉镜像），成功后才删旧容器（`panel/server/src/docker.ts:756-758`）——否则网络失败时会把唯一能用的容器删掉。

### 4. 打开桌面

`desktopHandler`（`panel/server/src/index.ts:1886-1903`）做三件事：会话校验 → `userCanAccess` → `attachViewer`（接管判定），然后给代理请求挂上 `_wocAuth`，由 `proxyReq` 注入 Basic（`panel/server/src/index.ts:1789-1795`）。

WebSocket 升级走 `panel/server/src/index.ts:1947-2036` 的独立路径，因为 raw upgrade 不经过 Fastify 的 `onRequest`，必须重新做 Host/会话/权限三道校验。

### 5. 输入

- 文本：`POST /api/instances/:id/type`（`panel/server/src/index.ts:1161-1176`）→ `typeInInstance`（`panel/server/src/docker.ts:2136-2158`）：借容器剪贴板 + Ctrl+V，上限 500 字符。
- 大文本：`/paste-text` 上限 200000 字符（`panel/server/src/index.ts:1213-1228`）。
- 图片：`/paste-image` 先校验 PNG 上限 1MB（老实例），新实例走原图（`panel/server/src/index.ts:1180-1209`；`panel/server/src/docker.ts:2195-2262`）。
- 前端无感输入桥在 `panel/web/src/pages/Desktop.tsx:182-308`，处理 composition、粘贴和按键顺序。

## 先读这 10 个文件

| 顺序 | 文件 | 为什么先读 |
|---|---|---|
| 1 | `README.md` | 定位、特性、资源估算、安全须知 |
| 2 | `doc/dev/架构守则.md` | 10 条不变式，全是 P0 学费，读代码前先读 |
| 3 | `docker-compose.yml` | 看清面板挂了什么、暴露什么 |
| 4 | `docker/Dockerfile` | 实例镜像的真面目：KasmVNC + 补丁 |
| 5 | `panel/server/src/index.ts` | 所有路由与反代主流程 |
| 6 | `panel/server/src/docker.ts` | 容器生命周期与所有 exec 操作 |
| 7 | `panel/server/src/store.ts` | 数据模型：Instance/User/AppType |
| 8 | `panel/server/src/sessions.ts` | 会话持久化与滑动续期 |
| 9 | `panel/server/src/host-guard.ts` | 安全边界的第一道门 |
| 10 | `panel/web/src/pages/Desktop.tsx` | 桌面页的 iframe/输入/音频状态机 |

## 关键类型与签名

```ts
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

// panel/server/src/docker.ts:746-748
function runInstance(inst: Instance, opts?: { keepImage?: boolean }): Promise<void>;

// panel/server/src/docker.ts:868
function upgradeInstance(inst: Instance, opts?: { skipPull?: boolean }): Promise<void>;

// panel/server/src/docker.ts:2698-2700
function instanceTarget(inst: Instance): string; // http://<containerName>:3000

// panel/server/src/sessions.ts:55-60
function createSession(userId: string): string;

// panel/server/src/index.ts:194-214
function requireAuth(req, reply): Promise<User | null>;
```

## 加功能改哪里

| 想做什么 | 改这些地方 | 注意 |
|---|---|---|
| 新增一种应用类型 | `panel/server/src/store.ts:29-30` 的 `AppType`；`docker/app-defs.sh:14-47`；`docker/app-ctl.sh` 的 install/status；`docker/autostart:13-19`；`panel/web/src/api.ts:21-47` | 旧镜像不认识新类型会回退微信；要兼容旧面板 |
| 新增一个 API | `panel/server/src/index.ts` 加路由 + `requireAuth/requireAdmin`；前端 `api.ts` | 上传路由必须自己限长（`upload.ts` 注释），Fastify bodyLimit 管不到 octet-stream |
| 新增容器参数 | `panel/server/src/docker.ts:484-508` 的 `envList` + `panel/server/src/docker.ts:749-842` 的 HostConfig | 必须写进声明式 createOpts，不能靠克隆旧容器 |
| 实例数据迁移 | `panel/server/src/store.ts:106-147` 的 `initStore` + `panel/server/src/docker.ts:678-700` 的 `ensureInstanceVolume` | 必须幂等，旧数据卷要能直接用 |
| 改桌面行为 | `panel/server/src/index.ts:1701-1906`（HTTP 反代）、`panel/server/src/index.ts:1947-2036`（WS）、`Desktop.tsx` | iframe 的 effect 必须依赖 `frameGen`，否则换文档后监听丢失（`doc/dev/稳定性设计.md:30`） |
| 改 UI 页面 | `panel/web/src/pages/*`、`parts.tsx`、`ui.tsx`、`styles.css` | 无组件库，全是手写 |

## 测试地图（诚实版）

**仓库没有单元测试/集成测试目录**，`package.json` 里也没有 `test` 脚本（`panel/server/package.json:5-9`；`panel/web/package.json:5-10`）。质量保障分三层：

| 层 | 做法 | 证据 |
|---|---|---|
| 类型检查 | 面板 server 与 web 各跑 `npx tsc --noEmit` | `doc/dev/发布门禁.md:25` |
| 构建门禁 | web `npm run build`；实例镜像构建时校验 KasmVNC 补丁特征串 | `doc/dev/发布门禁.md:22-26`；`docker/Dockerfile:143-148` |
| 运行时探针 | 5 项容器探针：DPI 98304、CEF 连跑两次、30s 无崩溃循环、微信等待安装、KasmVNC 参数 | `doc/dev/发布门禁.md:28-67` |
| 升级路径 | 用上一 release 的容器+卷原地升级，人工点公众号/附件 | `doc/dev/发布门禁.md:69-76` |

所以：**改代码后至少跑 `npx tsc --noEmit`；碰实例镜像必须按发布门禁跑容器探针**。没有自动回归，这是这个项目最大的工程债之一。

## 一句话记住

先读 `架构守则` 再读 `index.ts`：这个项目的复杂度不在业务，而在**一条远程桌面链路和一条升级链路的失败模式**。
