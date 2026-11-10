# 07 贡献：怎么跑、怎么测、怎么不被打回

> 这篇回答什么问题：想给 WOC 提 PR，本地要准备什么？改完跑什么？维护者最在意什么？哪些坑踩了会被直接打回？

## 环境要求

| 项 | 版本/说明 | 证据 |
|---|---|---|
| Docker + Compose 插件 | 能跑 `docker compose up -d`；Docker 29 + containerd 有已知 tag 陷阱 | `README.md:93-118`、`scripts/build-local.sh:26-34` |
| Node.js | 22（面板构建与运行镜像都用 `node:22-slim`） | `panel/Dockerfile:1-27` |
| 操作系统 | Linux / NAS（amd64 或 arm64）；Windows/macOS 只适合改前端代码 | `docker/Dockerfile:4`（baseimage 依赖 Linux 内核与 `/dev/shm`） |
| 可选 | 飞牛 `fnpack` CLI（打 `.fpk` 时才要） | `fnos/README.md` |

## 本地构建

```bash
git clone https://github.com/Gloridust/WechatOnCloud.git
cd WechatOnCloud
cp .env.example .env          # 至少改密码
./scripts/build-local.sh      # 构建面板 + 实例镜像
docker compose up -d
```

手动构建（必须带 `--provenance=false --sbom=false`，否则 Docker 29 + containerd 下 `:tag` 不跟新 manifest list，重建实例仍用旧镜像）：

```bash
docker build --provenance=false --sbom=false -t docker.io/gloridust/wechat-on-cloud:latest ./docker
docker build --provenance=false --sbom=false --build-arg WOC_VERSION=dev-$(git rev-parse --short HEAD) \
  -t docker.io/gloridust/woc-panel:latest ./panel
```

证据：`scripts/build-local.sh:26-34`。

## 测试与检查

**没有测试框架**。`panel/server/package.json` 与 `panel/web/package.json` 都没有 `test` 脚本（web 连 `lint` 也没有）。PR 前至少跑：

```bash
cd panel/server && npx tsc --noEmit
cd ../web && npx tsc --noEmit && npm run build
```

注意 `tsconfig` 里 `strict: true` 但 `noImplicitAny: false`——类型检查会放过隐式 any，别指望它兜住全部类型问题。

改实例镜像还要按 `doc/dev/发布门禁.md` 跑五项容器探针：

1. `dump_xsettings | grep "Xft/DPI 98304"`；
2. 裸 chromium 连跑两次、每次 7 秒（`--user-data-dir` 用临时目录）；
3. 30 秒内 `已退出` 计数为 0（无崩溃循环）；
4. `WOC_APP_TYPE=wechat` 等到「尚未安装」状态；
5. `dpkg-query -W kasmvncserver` + `/proc/$(pgrep -x Xvnc)/cmdline` 含 `-DLP_ClipTypes text/html` 与 `-NeverShared`，且 `grep WOC-IME` 命中补丁标记。

升级路径要拿上一 release 的容器 + 卷原地升级，人工点开公众号 / 附件（`doc/dev/发布门禁.md` 第 3 节）。

## CI 矩阵

`.github/workflows/release.yml` 定义 4 个构建任务：

| 镜像 | 架构 | Runner |
|---|---|---|
| `wechat-on-cloud` | linux/amd64 | `ubuntu-latest` |
| `wechat-on-cloud` | linux/arm64 | `ubuntu-24.04-arm` |
| `woc-panel` | linux/amd64 | `ubuntu-latest` |
| `woc-panel` | linux/arm64 | `ubuntu-24.04-arm` |

v1.4.3 之后改用**原生 arm64 runner**，不再 QEMU——QEMU 下 arm64 `apt-get update` 会 OOM（`getline: Cannot allocate memory`），曾让镜像反复发不出去（`release.yml:6-9` 注释）。

每个任务按 digest 推 GHCR，最后 merge job 用 `docker buildx imagetools create` 合成多架构 manifest、复制到 Docker Hub，再 `imagetools inspect` 校验（`release.yml:148-217`）。

冒烟门禁只在 `wechat && amd64` 任务跑（`release.yml:74-103`），因为它要在 CI 里真起一个容器。**没有单元测试 job、没有 lint job。**

另有 `.github/workflows/telegram-bot.yml` / `telegram-notify.yml` 做通知，与代码质量无关；所有事件文本经 env 传入以避免命令注入（`telegram-notify.yml:40-55`）。

## 一次完整的改动流程

以「给实例卡片加一个自定义标签」为例，说明这个仓库期望的工作顺序：

```bash
# 1. 开分支，命名对齐仓库习惯：<type>/<issue 或主题>
git switch -c feat/inst-tags

# 2. 先读守则，确认改动不违反 10 条不变式
$EDITOR doc/dev/架构守则.md

# 3. 服务端：数据模型 → 持久化 → API（都要过 requireAuth/requireAdmin）
#    store.ts 加字段 + publicInstance 决定是否下发
#    index.ts 加 PUT 路由
$EDITOR panel/server/src/store.ts panel/server/src/index.ts

# 4. 前端：api.ts 类型 → 页面
$EDITOR panel/web/src/api.ts panel/web/src/pages/Admin.tsx

# 5. 类型检查（唯一自动化门槛）
cd panel/server && npx tsc --noEmit && cd ../web && npx tsc --noEmit && npm run build

# 6. 本地起面板验证（不用真跑微信实例）
./scripts/build-local.sh && docker compose up -d

# 7. 提 PR：描述里写明「对应哪条守则 + 怎么验证」
```

关键约束：**新字段如果要下发给前端，必须同时决定它进不进 `publicInstance`**（`store.ts:257-268`）。这个函数是字段白名单，随手把整条记录展开就会泄漏 kasm 凭据——这是项目里已经发生过一次的事故（`index.ts:505` 注释）。

## Issue / PR 规则（从文档里提炼）

仓库没有 `CONTRIBUTING.md`，但 `doc/dev/架构守则.md` 是事实上的硬约束，10 条全部由线上事故写成：

| # | 守则 | 学费 |
|---|---|---|
| R1 | 一切依赖必须锚定，一切发布必须可回滚 | v1.3.0 apt 静默拉新 Chromium，`:latest` 被覆盖回不去 |
| R2 | 自身状态声明式重建，禁止克隆运行时环境 | v1.2.6 克隆旧 Hostname → 全员 502 |
| R3 | 任何可写路径必须有边界 | 「群晖一下子 1TB 没了」 |
| R4 | 预期超过 5 秒的操作一律异步 | 「完全无法更新实例」 |
| R5 | 面板与实例是独立发布单元，兼容矩阵显式处理 | 壁纸退出码 127、#101 写到 `/home/abc` |
| R6 | 根因标准 = 解释 100% 症状 + A/B 实证 | v1.3.1 只治住 Chromium，真根因 Xft/DPI 单位次日爆 |
| R7 | 外部/AI PR 审语义不只审形状 | #101 一次踩中四项（单位、真实路径、写死镜像源、shell 注入面） |
| R8 | 特性不当天发，P0 热修最小 diff | v1.2.8→v1.3.1 四版挤 48 小时，无法二分 |
| R9 | 冒烟必须覆盖「用户动作」不是「进程启动」 | DPI bug 逃过冒烟，因为崩的是「点开公众号」 |
| R10 | 重启必须幂等，自愈/重启绝不隐式换版本 | v1.3.0 看门狗把没点升级的实例换到坏镜像 |

PR 描述建议直接对应一条守则，并附「怎么验证」的命令/截图。

## 5 个新手入口

| 入口 | 难度 | 为什么适合 |
|---|---|---|
| 改进错误提示文案（`docker.ts:573-623` 的正则映射表） | 低 | 纯映射，收益直接，且能顺带读懂四阶段错误模型 |
| 给 `.env.example` 补一个配置说明 | 低 | 纯文档，能熟悉全部开关 |
| 新增一个内置应用图标（`panel/web/src/AppIcon.tsx`、`icons.tsx`） | 低 | 前端独立，易验证 |
| 给 `doc/dev/发布门禁.md` 增加一个探针 | 中 | 需要懂容器与微信启动 |
| 给 `host-guard.ts` 写单元测试 | 中 | 140 行纯函数，最适合作为引入测试框架的第一个目标（先和维护者确认） |

## 常见坑

| 坑 | 说明 | 证据 |
|---|---|---|
| 忘了 `--provenance=false --sbom=false` | Docker 29 + containerd 下构建产物可能不被实例重建采用 | `scripts/build-local.sh:26-34` |
| 改了 Dockerfile 但 KasmVNC 补丁失配 | 构建直接失败（这是设计，不是 bug） | `docker/Dockerfile:143-148`、`woc-www-patch.sh:21-28` |
| 用 `WOC_VERSION` 之外的方式改镜像 tag | 面板与实例版本耦合，可能拉不到 | `docker.ts:17-70` |
| 在业务路由里同步拉镜像 | 反代 60s 掐断 → 误报失败 → 并发重建 | `index.ts:518-525` |
| 直接改 `styles.css` 大段重排 | 与未合并的 claude 分支冲突概率极高 | 见 06 |
| 在 Windows 上跑实例 | Xvfb/KasmVNC 依赖 Linux 内核与 `/dev/shm` | `docker/Dockerfile:4` |
| 只改 env 然后 `docker restart` | env 只在创建容器时注入，必须 `up -d` 重建 | `index.ts:171-172` 的 hint |
| 给实例加 `--privileged` 图省事 | 直接违反 R3 与安全模型 | `doc/安全加固.md:11-27` |

## 一句话记住

给 WOC 提 PR 的门槛不是「代码能跑」，是**能通过那份用 P0 事故写成的发布门禁**——它没有单元测试，但有比多数团队更硬的十条规定。
