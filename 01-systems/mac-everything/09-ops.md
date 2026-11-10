# 09 运维手册

这篇回答什么问题：把 mac-everything 当成一个要长期跑在 Mac 上的常驻服务，安装、配置、看日志、排故障、升级各该怎么做。

## 安装

| 方式 | 步骤 | 适用 |
|------|------|------|
| DMG（推荐） | 从 Releases 下载 `MacEverything-<版本>-arm64.dmg` 或 `x86_64.dmg`，拖入「应用程序」，首次启动授予完全磁盘访问（`README.md:159-165`） | 普通用户 |
| 源码构建 | `brew install re2 abseil`，`xcodebuild -project MacEverything.xcodeproj -scheme MacEverything -configuration Release build SYMROOT=build`，再 `ditto build/Release/MacEverything.app /Applications/`（`README.md:167-185`） | 开发者 |
| 打包 DMG | `scripts/build-dmg.sh arm64 1.4.0`，静态链接 abseil 20260817.0 + re2 2025-11-05，输出 `dist/MacEverything-<版本>-<架构>.dmg` | 发布 |
| CLI 守护进程 | `make daemon` 后 `./maceverything-daemon --port 19860 --root /`（`Makefile:18-21`、`README.md:187-194`） | 无头/自动化 |

## 配置与默认值

| 项 | 默认值 | 证据 |
|----|--------|------|
| 扫描根 | `/`（全盘） | `ServiceEngine.h:21-26` |
| 缓存目录 | `~/Library/Caches/com.maceverything.app` | `PathUtils.h:11-16` |
| 日志目录 | `~/Library/Logs/MacEverything` | `PathUtils.h:18-23` |
| HTTP 端口 | GUI/daemon/MCP 均 19860 | `MacSearchBridge.mm:138`、`daemon_main.cpp:30`、`mcp_main.cpp:28` |
| 全局快捷键 | Option+Space | `README.md:165` |
| 内容索引 | 默认不索引任何扩展名（opt-in），单文件上限 1 MB，GUI 可调 0.1–10 MB | `ContentIndex.cpp:20-24`、`ContentIndex.h:144` |
| 内存分配器 | `MallocLargeCache=0`（Info.plist 的 LSEnvironment） | `Info.plist:17-21` |
| 扫描线程 | `hardware_concurrency` 限制在 4–32 | `DirectoryScanner.cpp:15-69` |

内容搜索配置落在缓存目录的 `content_config.txt`：第一行大小上限，其余每行一个扩展名，写入用 tmp+rename（`ContentIndex.cpp:45-80`）。

## HTTP API 与端口

服务只绑 `127.0.0.1`（`HttpServer.cpp:93-105`），端口占用时每秒重试一次、最多 5 次（`HttpServer.cpp:107-125`）。主要路由：`GET /api/search`、`/api/search/content`、`/api/recent`、`/api/status`、`/api/health`、`/api/content/config`；`POST /api/index/rebuild`、`/api/content/rebuild`、`/api/content/config`（`HttpServer.cpp:375-403`）。`limit` 默认 100、最大 10000，响应带完整 `timing` 字段（`HttpServer.cpp:409-520`）。

## 日志与可观测性

- 日志文件 `maceverything.log`，单文件 5 MB、保留 3 个（`Logger.h:64-65`）。
- 启动日志固定格式：`Incremental startup completed: N records — index load Xs, FSEvents replay Ys, total Zs`（`ServiceEngine.cpp:314-318`）。
- 慢查询看 `QueryTimingInfo` 的 lockWait/trigram/phase1/phase2/sort；trigram 诊断日志前缀 `DIAG-TRIGRAM`（`SearchEngineAdvancedQuery.cpp:639-655`）。
- 健康检查 `/api/health`；`/api/status` 返回 recordCount/liveRecordCount/contentIndexedFileCount（`HttpServer.cpp:565-579`）。

## 资源需求

- **磁盘**：v6 索引文件 740,159,038 字节（约 706 MiB），另有 WAL 上限 50 MB 和内容索引（`docs/audits/2026-10-22/path-table-dir-runs/report.md`）。
- **内存**：固定快照 6,381,948 条有效记录、Mach 物理足迹 573.0 MiB，这是作者本机口径，不是 RSS 承诺；GUI 短时 600–612 MB、vmmap 峰值 834.3 MB（同报告）。审计明确未证明全盘重建、压缩、全文索引时始终低于 1 GiB。
- **启动**：索引加载 2.43 s + FSEvents 回放 0.13 s，Phase 2 后台建 trigram 约 9.0 s；Phase 2 完成前查询可用但会退化（`docs/changelog/146`、`SearchEngineV6.cpp:11-126`）。

## 故障排查

| 症状 | 可能原因 | 处理 |
|------|----------|------|
| 搜不到某个目录的文件 | 未授予完全磁盘访问；`PermissionView.swift:33-36` 用 `~/Library/Safari` 探测 | 系统设置 → 隐私与安全性 → 完全磁盘访问，重启 App |
| 启动后结果明显变少 | FSEvents 丢事件触发 journalTruncated_，后台全量重建尚未完成 | 看日志是否有重建记录，等待扫描结束；不要同时手动重建 |
| 重建索引按钮无效 | main 上 GUI 只删 `index.bin/wal/pages/ptable`，不删 `index.v6`；HTTP 接口只发无人监听的通知（`SearchViewModel.swift:214-218`、`HttpServer.cpp:585-590`） | 退出 App，手动删除 `~/Library/Caches/com.maceverything.app` 下的缓存后重启；或合入 `fix/rebuild-index-v6` |
| MCP/AI 工具连不上 | GUI 未运行或 19860 被占；MCP 无重试队列 | 启动 GUI；`lsof -iTCP:19860` 查占用；确认没有第二个实例 |
| WAL 写失败后丢变更 | WAL 超 50 MB 时 `append` 返回 false，调用点未检查（`SearchEngine.cpp:380-533`） | 磁盘留足空间；避免长时间只增量不落盘 |
| 索引文件损坏 | v6 CRC/段边界校验失败，回退 v5/v3；WAL 坏条目截断 | 看日志 `CRC mismatch`；仍失败则删缓存全量重建 |
| 进程崩溃后索引回退 | 未 fsync 的 WAL 尾部丢失（每 syncInterval_ 条 fsync） | 属预期窗口；重要场景缩短 sync 间隔 |

## 容量规划

- **磁盘**：v6 约 706 MiB（740,159,038 字节），WAL 最多 50 MB，内容索引另算；升级/重建期间会同时存在 `index.v6.tmp` 和旧文件，预留 1.5–2 倍空间。
- **内存**：固定快照 573 MiB 是起点；查询临时峰值在优化后约 2.36–2.82 MiB（`docs/audits/2026-10-22/win-inspired/report.md:48-58`），但 Phase 2 建 trigram 期间会额外占用，GUI 峰值见过 834.3 MB。
- **文件数增长**：索引结构大体线性，但目录数、路径深度、长文件名会让路径池和 trigram 膨胀；推断：文件数翻倍时不要假设内存只翻倍，先按同一口径复测。
- **低配机器**：8 GB 内存的 Mac 建议关掉内容索引、缩短 WAL 刷盘间隔；不要同时跑全盘重建和大型编译。

## 安全

- HTTP 无鉴权，只靠绑定 `127.0.0.1`；本机任意进程都能查询文件元数据，介意的话关闭 HTTP 端口（`ServiceConfig.httpPort=0` 表示不启动）。
- MCP 同样是本机 stdio + localhost 转发，不对外网开放。
- 索引缓存含完整文件路径和文件名，未加密；共享 Mac 上应限制 `~/Library/Caches/com.maceverything.app` 的权限。
- 扫描根为 `/` 时需要完全磁盘访问，这是权限放大器：只应在可信账户下运行。
- 日志同样含完整路径：`~/Library/Logs/MacEverything/maceverything.log*` 默认保留 3 个 5 MB 文件，报障前先脱敏，别把日志直接贴到公开 issue。
- 升级前可备份整个缓存目录；它既是回滚点，也是出问题时的取证材料，但注意其中含全盘文件清单。
- 缓存目录默认只对当前用户可读，但同账户的任意进程都能读取；敏感环境要额外做磁盘加密或目录隔离。

## 升级与回滚

- 升级：替换 `/Applications/MacEverything.app` 后重启；v6 头有 `formatVersion`，格式不兼容时会回退旧格式或全量重建（`FlatIndexWriter.h:35-78`、`IndexPersistence.cpp:30-92`）。
- 回滚：保留旧 App 与缓存目录；若新版本改过索引格式，回滚前删缓存让旧版重建，别让旧二进制读新格式。
- 强制重建：退出 App → 删除 `~/Library/Caches/com.maceverything.app` → 重启；这是当前 main 上最可靠的“重建索引”办法（分支修好后可用菜单/HTTP）。

一句话记住：把它当一个只信本机回环、内存有硬预算的常驻索引服务来运维——权限、磁盘、WAL 上限和 19860 端口是四个最常出问题的地方。
