# 07 贡献：怎么跑、怎么测、怎么不被打回

> 这篇回答什么问题：想给 WOC 提 PR，本地要准备什么？改完跑什么？维护者最在意什么？

## 环境要求

| 项 | 版本/说明 | 证据 |
|---|---|---|
| Docker + Compose 插件 | 能跑 `docker compose up -d` | `README.md:78` |
| Node.js | 22（面板构建与运行镜像都用 node:22-slim） | `panel/Dockerfile:4-27` |
| 操作系统 | Linux / NAS（amd64 或 arm64）；Windows/macOS 只适合改代码，不适合跑实例 | `README.md:39`、`README.md:59` |
| 可选 | 飞牛 `fnpack` CLI（打 .fpk 时才要） | `fnos/README.md:21-27` |

## 本地构建

```bash
git clone https://github.com/Gloridust/WechatOnCloud.git
cd WechatOnCloud
cp .env.example .env          # 至少改密码
./scripts/build-local.sh      # 构建面板 + 实例镜像
docker compose up -d
```

手动构建（发布门禁要求带 `--provenance=false`，否则 Docker 29+ 下实例重建可能仍用旧镜像）：

```bash
docker build --provenance=false --sbom=false -t ghcr.io/gloridust/wechat-on-cloud:latest ./docker
docker build --provenance=false --sbom=false --build-arg WOC_VERSION=dev-$(git rev-parse --short HEAD) \
  -t ghcr.io/gloridust/woc-panel:latest ./panel
```

证据：`doc/dev/发布门禁.md:20-26`；`scripts/build-local.sh:11-42`。

## 测试与检查

**没有测试框架**。`panel/server/package.json:5-9` 与 `panel/web/package.json:5-10` 都没有 `test` 脚本。PR 前至少：

```bash
cd panel/server && npx tsc --noEmit
cd ../web && npx tsc --noEmit && npm run build
```

改实例镜像还要按 `doc/dev/发布门禁.md:28-67` 跑五项容器探针：XSETTINGS DPI 98304、CEF 连跑两次、30 秒无崩溃循环、微信模式等待安装、KasmVNC 参数与补丁。升级路径要拿上一版容器+卷实测（`doc/dev/发布门禁.md:69-76`）。

## CI 矩阵

`.github/workflows/release.yml:22-32` 定义 4 个构建任务：

| 镜像 | 架构 | Runner |
|---|---|---|
| `wechat-on-cloud` | linux/amd64 | `ubuntu-latest` |
| `wechat-on-cloud` | linux/arm64 | `ubuntu-24.04-arm` |
| `woc-panel` | linux/amd64 | `ubuntu-latest` |
| `woc-panel` | linux/arm64 | `ubuntu-24.04-arm` |

每个任务按 digest 推 GHCR，最后 merge job 用 `docker buildx imagetools create` 合成多架构 manifest，并复制到 Docker Hub（`.github/workflows/release.yml:149-217`）。没有单元测试 job、没有 lint job。

另有 `.github/workflows/telegram-bot.yml` / `telegram-notify.yml` 做 Telegram 通知，与代码质量无关。

## Issue / PR 规则（从文档里提炼）

仓库没有 `CONTRIBUTING.md`，但 `doc/dev/架构守则.md` 是事实上的硬约束：

1. **依赖必须锚定**：版本 tag、base digest、Chromium 快照号；发版必须能给回滚指引（`doc/dev/架构守则.md:7-14`）。
2. **禁止克隆运行时配置**：重建容器必须声明式生成（`doc/dev/架构守则.md:16-20`）。
3. **任何可写路径必须有边界**：新缓存/新上传/新日志都要写 TTL 或容量上限（`doc/dev/架构守则.md:22-30`）。
4. **超过 5 秒的操作必须异步**：立即返回 + 后台 + 进度查询（`doc/dev/架构守则.md:32-36`）。
5. **审语义不只审形状**：数值单位、真实路径、写死镜像源、shell 注入面（`doc/dev/架构守则.md:56-66`）。
6. **P0 热修最小 diff**：不夹带特性（`doc/dev/架构守则.md:68-74`）。

PR 描述建议直接对应一条守则，并附「怎么验证」的命令/截图。

## 3–5 个新手入口

| 入口 | 难度 | 为什么适合 |
|---|---|---|
| 改进错误提示文案（`panel/server/src/docker.ts:573-629`） | 低 | 纯映射表，收益直接 |
| 给 `.env.example` 补一个配置说明 | 低 | 纯文档，能熟悉全部开关 |
| 新增一个内置应用图标（`panel/web/src/AppIcon.tsx`、`panel/web/src/icons.tsx`） | 低 | 前端独立，易验证 |
| 给 `doc/dev/发布门禁.md` 增加一个探针 | 中 | 需要懂容器与微信启动 |
| 为 `host-guard.ts` 写单元测试 | 中 | 仓库无测试框架，需要先引入（先和维护者确认） |

## 常见坑

| 坑 | 说明 | 证据 |
|---|---|---|
| 忘了 `--provenance=false` | Docker 29+ 下构建产物可能不被实例重建采用 | `doc/dev/发布门禁.md:20-22` |
| 改了 Dockerfile 但 KasmVNC 补丁失配 | 构建直接失败（这是设计） | `docker/Dockerfile:120-122`、`docker/Dockerfile:143-148` |
| 用 `WOC_VERSION` 之外的方式改镜像 tag | 面板与实例版本耦合，可能拉不到 | `panel/server/src/docker.ts:17-70` |
| 在业务路由里同步拉镜像 | 反代 60s 掐断 → 误报失败 → 并发重建 | `panel/server/src/index.ts:518-525` |
| 直接改 `styles.css` 大段重排 | 与未合并的 claude 分支冲突概率高 | `06-branches.md` |
| 在 Windows 上跑实例 | Xvfb/KasmVNC 依赖 Linux 内核与 /dev/shm | `docker/Dockerfile:4-20` |

## 一句话记住

给 WOC 提 PR 的门槛不是「代码能跑」，是**能通过那份用 P0 事故写成的发布门禁**。
