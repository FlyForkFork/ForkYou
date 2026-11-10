# 09 · 运维手册：一台机器跑起来之后要盯什么

**这篇回答什么问题**：这个系统怎么部署、要占多少资源、数据落在哪、出问题怎么查、升级怎么回滚、有哪些安全口子必须先堵。

## 结论先行

1. **官方只给一种部署形态：单容器 + 9 个宿主机目录挂载**。`docker-compose.yaml` 里只有一个 `app` 服务，没有 Redis、没有独立数据库、没有反向代理。
2. **没有服务端鉴权**。所有 `/api/*` 接口裸奔，`/auth/status` 只做明文用户名密码比较（`src/app.py:144-149`），WebSocket 广播无鉴权（`src/api/routes/websocket.py:39-57`）。**只能部署在内网或加一层反代**。
3. **状态全在一个 SQLite 文件里**：`data/app.sqlite3`。备份它 + `state/` 就等于备份了整个系统。
4. **可观测性只有文件日志 + 一个 `/health`**。没有 Prometheus 指标、没有结构化日志、没有 trace。

## 部署方式（三种，选一种）

### 方式 A：Docker Compose（推荐）

```bash
cp .env.example .env            # 填 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL_NAME
docker compose up -d            # 拉 ghcr.io/usagi-org/ai-goofish:latest
docker compose logs -f app      # 看主进程日志
```

`docker-compose.yaml` 的关键点：

| 配置 | 值 | 说明 |
|---|---|---|
| `image` | `${APP_IMAGE:-ghcr.io/usagi-org/ai-goofish:latest}` | 可用 `APP_IMAGE` 覆盖成固定 digest |
| `pull_policy` | `always` | **每次 `up` 都会拉最新，升级不受控**；要固定版本就改这里 |
| `init` | `true` | 用 tini 做 PID 1，处理信号 |
| `ports` | `8000:8000` | 单端口，前端静态资源与 API 同源 |
| `environment` | `APP_DATABASE_FILE=/app/data/app.sqlite3` | 数据库路径 |
| `restart` | `unless-stopped` | 崩溃自动重启 |

挂载 9 个路径（`docker-compose.yaml:14-22`）：`.env`、`data`、`state`、`config.json`、`prompts`、`jsonl`、`logs`、`images`、`price_history`。

**坑**：`./config.json:/app/config.json` 要求宿主机上 `config.json` **必须先存在**，否则 Docker 会创建一个同名目录，容器里读配置直接报错。第一次部署前 `cp config.json.example config.json`。

### 方式 B：`start.sh`（裸机 / WSL）

六步：检查环境 → 清 `dist/` → `pip install` → `npm run build` → 校验 `dist/index.html` → `python3 -m src.app`。脚本会自动识别 macOS / Linux(deb/rpm/arch) / WSL / Windows(MSYS) 并打印缺依赖的修复命令（`start.sh:35-53`、`:112-330`）。

适合开发机，不适合生产：没有进程守护、没有日志轮转、重启靠人。

### 方式 C：桌面版（PyInstaller）

`desktop_launcher.py`（46 行）是打包入口：`_MEIPASS` 环境下 chdir、插 `sys.path`、`webbrowser.open` 打开浏览器、`uvicorn.run(host="127.0.0.1")`。只监听回环，天然安全。**待查实**：仓库里没有 PyInstaller 的 spec 文件，打包脚本可能在别处或由发布流程外部维护。

## 目录与数据

| 路径 | 内容 | 备份优先级 |
|---|---|---|
| `data/app.sqlite3` | 任务、结果、价格快照、黑名单规则 | **P0** |
| `state/*.json` | 闲鱼登录态（cookies + 浏览器指纹） | **P0**，且含敏感凭据 |
| `prompts/*.txt` | base prompt 与每个任务生成的 criteria | P1，重建成本高（要调 AI 生成） |
| `logs/` | 每个任务一个 `logs/<任务名>_<id>.log`（`src/utils.py:86-90`）；`logs/ai/<时间戳>.log` 是 AI 请求元数据 | P2，默认只留 7 天 |
| `images/` | 商品图缓存，分析完即删（`item_analysis_dispatcher.py:143-144`） | P3 |
| `jsonl/`、`price_history/` | 历史遗留目录，已迁进 SQLite，仅兼容旧数据 | P3 |
| `dist/` | 前端构建产物，可由 `npm run build` 重建 | 不备份 |

日志清理在启动时跑一次：`cleanup_task_logs(keep_days=app_settings.task_log_retention_days)`（`src/app.py:65-94`），保留天数由 `TASK_LOG_RETENTION_DAYS` 控制，默认 7（`src/infrastructure/config/settings.py:101-106`）。**注意它只删 `logs/*.log`，不删 `logs/ai/*.log`**（`src/services/task_log_cleanup_service.py:26` 的 `root.glob("*.log")` 不递归）。

## 资源需求

| 资源 | 估算 | 依据 |
|---|---|---|
| 内存 | 单容器 1–2 GB 起，多任务并发时按每个 Chromium 实例 200–400 MB 叠加 | 推断：Playwright Chromium 常见占用；`Dockerfile` 里专门禁 crashpad 就是因为"自监控重启吃内存"（`src/scraper.py:117-134` 注释） |
| CPU | 2 核起；AI 分析是网络等待，不吃 CPU；Chromium 渲染吃 | 推断 |
| 磁盘 | 镜像约 1.5–2 GB（含 Chromium）；数据按结果量增长，SQLite 单文件 | 推断：`Dockerfile:41` 装完整 Chromium + 系统依赖 |
| 网络 | 出站需访问 goofish.com、AI 网关、通知渠道；建议配 `PROXY_URL` 给 AI 单独走代理 | `README.md` 配置说明 |

**没有官方资源基线**，以上是推断。真实压测方案见 `05-performance.md` 的容量估算。

## 可观测性

| 手段 | 位置 | 说明 |
|---|---|---|
| 健康检查 | `GET /health`（`src/app.py:128-131`） | 固定返回 `{"status":"healthy"}`，**不检查 DB、不检查磁盘、不检查 Playwright**，只能当探活用 |
| 任务日志 | `logs/<任务名>_<id>.log` | 子进程 stdout/stderr 直接重定向（`process_service.py:111-117`），内容是 `log_time()` 打的中文流水 |
| AI 请求日志 | `logs/ai/<时间戳>.log` | 只记模型名、耗时、token 等元数据，不落完整 prompt（`ai_handler.py:341-369`） |
| Web UI | `/logs` 页面 | 走 `src/api/routes/logs.py:18-52` 的 8KB 块倒读 + 行分页，不用把大文件读进内存 |
| 任务状态 | WebSocket `task_status_changed` | 前端实时刷新，断线不补发（`websocket.py:39-57`） |
| 指标 | **无** | 没有 `/metrics`，`grep -rn "prometheus\|/metrics" src/` 零命中 |

**排查建议**：先用 `/health` 确认进程活着，再看 `docker compose logs -f app`（主进程），最后看具体任务的 `logs/*.log`（子进程）。任务跑不动但主进程正常，问题一定在子进程日志里。

## 典型故障与排查

| 症状 | 最可能原因 | 排查/处理 |
|---|---|---|
| 任务启动即失败，日志写"未找到可用的登录态" | `state/` 下没有 json，或任务绑定的账号文件不存在 | Web UI 账号页重新导入；`spider_v2.py:94-97` 有明确退出逻辑 |
| 抓两页就停，日志出现 `baxia-dialog-mask` / `J_MIDDLEWARE_FRAME_WIDGET` | 触发风控弹窗 | 换账号/代理；`RUN_HEADLESS=false` 手动过一次滑块；等 24h 熔断恢复 |
| 详情接口返回 `FAIL_SYS_USER_VALIDATE` | 单商品级风控 | 代码会随机睡 3–60s 后抛 `RiskControlError`（`src/scraper.py:1049-1065`），本次任务直接结束 |
| 连续失败 3 次后任务再也不启动 | `FailureGuard` 把任务暂停 24h | 看 `logs/task-failure-guard.json` 的 `paused_until`；更新 cookie 文件会自动解除（`failure_guard.py:247-261`） |
| 容器启动报浏览器路径权限错误 | `PLAYWRIGHT_BROWSERS_PATH` 与运行用户不匹配 | 镜像已用 `/ms-playwright` + `chown` 解决；自定义镜像别再改回 root 缓存目录（对照 `revert-373` 分支） |
| 数据库 `database is locked` | 多进程同时写 SQLite | 连接已设 `busy_timeout=5000`（`sqlite_connection.py:107-111`）；仍报错说明有长事务，查是不是大结果集导出 |
| 页面刷新 404 | 前端没构建，`dist/` 不存在 | `src/app.py:123-124` 只有 `dist` 存在才 mount `/assets`；跑 `cd web-ui && npm run build` |
| 改完 `.env` 不生效 | 容器 env_file 在启动时读取，热改无效 | `docker compose up -d --force-recreate` |

## 安全清单（按优先级）

1. **改默认密码**。默认 `admin/admin123`（`settings.py:101-106`），README 也写了。但改了也只是挡住前端登录页——见第 2 条。
2. **`/api/*` 无鉴权**。`grep -rn "Depends(.*auth\|Authorization\|session" src/` 零命中，任何人访问 `http://host:8000/api/tasks` 就能增删任务、读结果、导出 CSV。**必须在前面加 Nginx/Caddy 的 Basic Auth 或 IP 白名单**。
3. **`state/*.json` 是账号凭据**。里面有 cookies，泄露等于闲鱼账号被接管。`xianyu-login-state-privacy.html` 专门说明过。目录权限至少 700。
4. **WebSocket 无鉴权**。`ws://host:8000/ws` 直接能收到任务状态广播，消息里含任务名和结果摘要。
5. **`/docs` 默认开启**。FastAPI 自动挂 OpenAPI 文档，不关的话等于把全部接口清单送给扫描器。
6. **AI key 落盘在 `.env`**，且被挂进容器。`.gitignore` 已覆盖 `.env`，但别在 issue/截图里贴出来。

## 升级与回滚

**升级**：

1. 备份 `data/` 与 `state/`（`tar czf backup-$(date +%F).tgz data state prompts`）。
2. `docker compose pull && docker compose up -d`。
3. 看启动日志有没有 `bootstrap_sqlite_storage` 的迁移输出。

**迁移机制**：`src/infrastructure/persistence/sqlite_bootstrap.py:28-41` 在 `threading.Lock` 内建表，并用 `app_metadata` 里的键（`bootstrap:legacy_tasks` / `legacy_results` / `legacy_price_snapshots` / `migration:result_items_status`）标记"已执行"。**幂等，可重复启动**，但只前进不回退——字段迁移（`sqlite_connection.py:126-140` 加 `status` 列）没有 down migration。

**回滚**：

- 镜像层：把 `docker-compose.yaml` 的 `APP_IMAGE` 固定到上一个 digest，`pull_policy: never` 后 `up -d`。
- 数据层：只能用备份覆盖。**如果新版本已经跑过 schema 迁移，旧版本镜像可能读不了新库**——所以升级前那次备份是唯一保险。

**版本节奏**：GitHub Releases 现有 v2.1 → 2.5 共 5 个，最新 2.5 发布于 2026-10-09，master 最后一个 commit 是 2026-10-10。镜像 `latest` 跟着 master 走，不等 release。

## 一句话记住

单容器 + SQLite + 9 个挂载目录，备份 `data/` 和 `state/` 就够；上线前必须在前面套一层鉴权，因为应用本身对 `/api/*` 完全不设防。
