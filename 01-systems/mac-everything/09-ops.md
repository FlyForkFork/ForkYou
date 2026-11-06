# 09 运维：部署、配置、故障

> 这篇回答：怎么装、怎么配、坏了怎么查。

## 安装/部署

| 方式 | 步骤 | 适用 |
|---|---|---|
| DMG（推荐） | 下载对应架构 DMG → 拖入 `/Applications` → 启动 → 授予“完全磁盘访问” → 等首次索引 | 普通用户 |
| 源码构建 | `brew install re2 abseil` → `xcodebuild ... -scheme MacEverything -configuration Release build SYMROOT=build` → `ditto` 到 `/Applications` | 开发者 |
| 无头 daemon | `make daemon` → `./maceverything-daemon --port 19860 --root /` | 服务器/自动化 |
| MCP | 菜单栏 → MCP Integration → 勾选 Claude Code/Cursor/Claude Desktop，自动写配置 | AI 工具用户 |

DMG 分 `arm64` 与 `x86_64`，文件名带版本号，发布时附 `SHA256SUMS.txt`（`README.md:159-185`、`.github/workflows/release.yml:55-75`）。

## 配置项

| 配置 | 默认值 | 位置/说明 |
|---|---|---|
| 扫描根 | `/` | `MacEverything/Bridge/MacSearchBridge.mm:131-139`；daemon 用 `--root` 覆盖 |
| 缓存目录 | `~/Library/Caches/com.maceverything.app` | `MacEverything/Core/PathUtils.h:11-16` |
| 日志目录 | `~/Library/Logs/MacEverything` | `MacEverything/Core/PathUtils.h:18-23` |
| HTTP 端口 | `19860` | `MacEverything/Bridge/MacSearchBridge.mm:138`；`0` 表示不启动（`MacEverything/Core/ServiceEngine.h:25`） |
| 全局快捷键 | `Option+Space` | 可在 Shortcut Settings 改（`README.md:53`） |
| 开机自启 | 关 | `SMAppService` 注册（`MacEverything/App/AppDelegate.swift:320-332`） |
| 全文索引文件类型/大小 | 内置默认，可在 Content Settings 改 | `README.md:107` |
| Malloc 大缓存 | 关闭（`MallocLargeCache=0`） | `MacEverything/Info.plist:21-24`；debug 运行不生效 |

## 数据/日志/端口

| 项 | 路径/值 | 说明 |
|---|---|---|
| 索引文件 | `<cache>/index.v6` | 当前格式；兼容 `pages`、`index.bin` |
| WAL | `<cache>/index.wal`（实现中由 `IndexPersistence` 管理） | 50 MB 上限，CRC 校验 |
| 内容索引 | `<cache>/content.*` | `ContentIndexPersistence` 管理 |
| 实例锁 | `<cache>/.instance.lock` | `MacEverything/Core/ServiceEngine.cpp:169-170`，`flock` 防多实例写坏索引 |
| 日志 | `~/Library/Logs/MacEverything/` | 默认 Info 级；`DEBUG` 编译为 Debug 级（`MacEverything/Bridge/MacSearchBridge.mm:104-110`） |
| HTTP | `http://localhost:19860` | 只绑定本机；`/api/health`、`/api/status` 可用于探活 |

## 资源需求

| 资源 | 量级 | 证据 |
|---|---|---|
| 磁盘 | 索引约 740 MB（6,460,706 条记录的快照） | `docs/audits/2026-10-22/path-table-dir-runs/report.md:67` |
| 内存 | 固定快照就绪 573 MiB；GUI 实时约 600–612 MB | `docs/audits/2026-10-22/path-table-dir-runs/report.md:27-31,77` |
| 启动 | 加载约 2.4 s + Phase 2 约 9 s | `docs/audits/2026-10-22/path-table-dir-runs/report.md:31,79` |
| CPU | 空闲约单核 0.2–0.52% | `docs/audits/2026-10-21/memory-optimization-2/report.md:47` |
| 权限 | 完全磁盘访问 | `README.md:163` |

## 可观测性

- `GET /api/status`：`recordCount`、`liveRecordCount`、`contentIndexedFileCount`（`MacEverything/Core/HttpServer.cpp:565-575`）。
- `GET /api/health`：轻量探活，适合脚本/监控。
- 搜索响应带 `timing`：`lockWaitMs / trigramMs / phase1Ms / phase2Ms / sortMs / lockHeldMs / candidates / usedTrigram / searchPath`（`MacEverything/Core/HttpServer.cpp:409-478`）。
- 日志关键字：`DIAG-TRIGRAM`（候选为什么被跳过）、`CRC mismatch at offset`（WAL 损坏）、`journal truncated`（FSEvents 断档）。
- 进程状态：菜单栏图标存在但无窗口是正常状态；`isScanning` / `isMonitoring` / `isSyncing` 可通过状态查询间接判断。

日常巡检建议按这个顺序：先 `curl -s localhost:19860/api/health` 确认进程活着；再 `/api/status` 看 `recordCount` 与 `liveRecordCount` 的差值（墓碑太多说明该压缩）；再抽一条 `curl "localhost:19860/api/search?q=readme&limit=1"` 看 `timing.searchPath` 是否符合预期（`trigram` 还是 `linear`）；最后看日志尾部有没有 ERROR/WARN。三步都正常，才说明“索引加载、查询、监控”三条链路都通。

## 故障模式

| 现象 | 可能原因 | 排查 |
|---|---|---|
| 搜不到任何文件 | 没有“完全磁盘访问”；首次索引未完成 | 系统设置 → 隐私与安全性 → 完全磁盘访问；看日志是否 `Scan` 卡住 |
| 结果不更新 | FSEvents 流被截断/进程未监控 | 日志搜 `journal truncated`；重启应用触发全量重扫 |
| 启动很慢 | Phase 2 建 trigram；缓存缺失触发全盘扫描 | 日志看 `Phase 2`；确认 `index.v6` 存在且大小正常 |
| 端口被占用 | 19860 已被其他进程占用 | `lsof -iTCP:19860 -sTCP:LISTEN`；改端口或退出占用进程 |
| WAL 恢复报错 | 断电/磁盘满导致尾部损坏 | 日志 `CRC mismatch at offset ... recovered N entries`；应用会保留损坏前记录，可删缓存重建 |
| 内存异常高 | `MallocLargeCache` 未生效（debug 运行） | `ps eww` 看环境变量；Release + LaunchServices 启动 |
| 同一索引被两个进程打开 | 实例锁未生效/被绕过 | 确认 `<cache>/.instance.lock`；`flock` 是 advisory，不要手动删锁文件 |
| 索引重建后结果重复 | 旧版本 bug（根目录重扫未完整替换） | 升级到包含 `fix/root-rescan-duplicates` 的 main；重建索引 |

## 升级/回滚

- **升级**：v6 读取器兼容 `index.v6 → pages → index.bin`；新版本会优先读 v6，旧缓存可自动迁移（`MacEverything/Core/IndexPersistence.cpp:30-92`）。
- **回滚**：旧版本读取器能读新版 v6（审计报告明确验证过），但**新格式 section 可能被旧版忽略**；最稳妥是回滚前备份 `<cache>`。
- **强制重建**：退出应用 → 删除 `~/Library/Caches/com.maceverything.app` → 重启；会触发全盘扫描，耗时取决于磁盘和文件数。
- **版本不一致**：`MacEverything/Info.plist` 是 1.2/3，`MacEverything/Core/ServiceEngine.h:170` 的 `kAppVersion` 是 1.1.0；排障时以 `MacEverything/Info.plist` / About 为准，不要被日志里的 `app_version` 误导。

**一句话记住：** 先用 `/api/status` 和日志确认“索引是否加载、监控是否在跑、WAL 是否损坏”，再决定重建还是回滚。
