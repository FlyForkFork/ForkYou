# 01 定位：mac-everything 是什么

> 这篇回答什么问题：它是什么、谁在什么场景下用、凭什么值得学，以及这个项目现在健康不健康。

## 一句话

mac-everything 是把 Windows 上 Everything 的“输入即出结果”体验搬到 macOS 的菜单栏文件搜索工具：C++20 引擎维护全盘索引，SwiftUI 只负责一层很薄的交互壳（`README.md:7-9`、`MacEverything/App/AppDelegate.swift:6-8`）。

## 谁在什么场景下用它

- **开发者**：记得文件名但忘了目录，按 `Option+Space` 直接搜 `ext:swift`、`MacEverything/a` 或 `infile:timeout`。
- **运维/数据工作者**：在几百万个文件里按 `size:>1mb`、`dm:today`、`path:` 组合过滤，不想等 Finder。
- **自动化场景**：通过 `localhost:19860` 的 HTTP API 或 MCP 工具，把本地文件检索接给脚本与 AI 编程助手（`README.md:125-136`、`MacEverything/Core/HttpServer.cpp:375-403`）。
- **不想开 Finder、也不想等 Spotlight 转圈的人**：应用常驻菜单栏、不占 Dock，再按一次快捷键就关闭并回到原应用（`README.md:53`）。

## 没有它之前，人们怎么做

1. **Spotlight**：按 `Cmd+Space` 搜，但结果按系统排序，文件名精确匹配经常排在后面，索引范围不可见。
2. **Finder 搜索**：输入后要等系统遍历，条件组合弱，百万文件时体验接近“卡住”。
3. **终端 `find` / `fd`**：每次查询重新遍历目录；`fd` 虽快，但没有常驻全盘索引，冷启动仍受目录规模限制（外部来源：fd README）。
4. **Raycast / Alfred**：启动器体验好，但文件搜索主要复用 Spotlight 元数据索引，粒度与可控性有限。

## 它解决的三个痛点

| 痛点 | 具体表现 | 这个项目的做法 |
|---|---|---|
| 搜得慢 | Spotlight/Finder 在百万文件下延迟不可控 | 名称 trigram + 扩展名倒排先缩候选，再并行扫描（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:629-750`） |
| 搜不准 | 文件名包含、前缀、glob、正则混在一起 | 手写 tokenizer + 递归下降 AST + 语义变换，支持 `ext/size/dm/type/path` 等过滤器（`MacEverything/Core/QueryTokenizer.h:163-182`、`MacEverything/Core/QueryParser.cpp:21-29`） |
| 搜不全 | 系统索引可能排除某些目录，或只索引元数据 | 自己扫 `/`，记录文件名/路径/类型/大小/修改时间；内容搜索另建 trigram 索引（`MacEverything/Core/DirectoryScanner.cpp:145-164`、`MacEverything/Core/ContentIndex.h:144`） |

## 竞品对比

| 方案 | 定位 | 核心差异 | License | 成熟度 |
|---|---|---|---|---|
| **Everything** | Windows 文件名搜索标杆 | 只支持 Windows；NTFS 的 USN Journal 让索引近乎零成本，macOS 无法复刻 | 免费软件（voidtools 自定义许可） | 长期稳定（版本以官网为准） |
| **Spotlight** | macOS 系统级元数据搜索 | 系统内置、覆盖全；但排序不可控、不能按“文件名包含”精确控制，也没有可替换的候选机制 | 闭源，随 macOS 提供 | 系统级，最成熟 |
| **Raycast / Alfred** | 启动器 + 工作流 | 交互和扩展生态强；文件搜索依赖系统索引，不是自建全盘索引 | 闭源商业软件（免费版 + Pro 订阅） | 高 |
| **fd** | 命令行 `find` 替代品 | Rust 并行遍历、语法友好；无持久索引，每次查询重新扫目录 | MIT / Apache-2.0 双许可 | 高 |
| **mac-everything** | macOS 菜单栏 Everything | 自建内存索引 + 磁盘 v6/WAL + FSEvents；C++20 + SwiftUI；同时提供 GUI/HTTP/MCP | MIT | 个人项目，v1.4.0（Build 4） |

差异的关键不是“谁快”，而是**索引所有权**：Everything 借操作系统日志，Spotlight 借系统元数据，Raycast/Alfred 借 Spotlight；mac-everything 自己扫、自己存、自己增量维护，所以能在 macOS 上控制候选集与排序。代价是要自己处理完全磁盘访问权限、内存和持久化。

## 为什么是现在

- macOS 14+ 的 FSEvents、`getattrlistbulk` 与 Apple Silicon NEON 都已稳定，能在用户态做到“扫一次、之后只处理增量”（`README.md:17`、`MacEverything/Core/FileSystemWatcher.cpp:52-63`）。
- 638 万条记录的索引能压到 573.0 MiB 物理足迹（`docs/audits/2026-10-22/path-table-dir-runs/report.md:25-31`），这是“常驻菜单栏”可行的前提。
- AI 编程工具需要本地文件上下文，MCP/HTTP 让同一引擎多出一种分发方式（`README.md:125-136`、`MacEverything/CLI/mcp_main.cpp:402-405`）。

## 项目健康度

| 指标 | 值 | 日期/证据 |
|---|---|---|
| 提交数 | 439 | 2026-11-09，`git rev-list --count HEAD` |
| 文件数 | 534；Core 62 个 C++ 头/源，22 个 Swift | 2026-11-09，`git ls-files` |
| 测试文件 | 87 个 `tests/test_*`（另有 `mcp_config_harness` 目录） | 2026-11-09，`ls tests` |
| Star | 1 | 2026-11-10，work.json |
| 分支 | 5：main + 2 个已合并 + 2 个未合并（见 06） | 2026-11-10，`git branch -r` |
| 版本 | 1.4.0（Build 4） | `MacEverything/Info.plist:17-21` |
| License | MIT | `LICENSE`、`README.md:18` |

风险：单人项目、star 少、长期维护未知；`MacEverything/Core/ServiceEngine.h:175` 的 `kAppVersion` 仍写 `"1.1.0"`，与 `Info.plist` 的 1.4.0 不一致。推断：该常量只用于索引元数据，不影响 About 显示，但说明“版本单一来源”没有做好。

## 什么情况下别选它

- **文件量不大**：如果只有几万到十几万个文件，Spotlight 或 `fd` 已经够快，573 MiB 的常驻足迹和首次全盘扫描不划算。
- **拿不到完全磁盘访问**：`DirectoryScanner` 扫 `/` 时会撞上 TCC 保护的目录，索引天然不全；这时系统搜索反而更省心。
- **主要搜网络卷/移动盘**：扫描默认跳过跨挂载点（`DirectoryScanner.cpp:15-69` 记录 rootDevId），外接盘拔掉后记录也可能过期，不适合当 NAS 索引。
- **需要大文档全文搜索**：内容索引默认不启用、单文件上限 1 MB（可调到 10 MB），定位是“代码/文本片段”，不是文档仓库。
- **多人共用一台 Mac**：HTTP 只绑回环但没有鉴权，缓存里是完整路径，共享账户下要自己加权限边界。

## 应用地址

- 上游：https://github.com/YuSec2021/mac-everything
- Fork：https://github.com/FlyForkFork/mac-everything
- 本地源码：`D:\FlyForkFork\mac-everything`
- 本分析：`ForkYou/01-systems/mac-everything/`

**一句话记住：** Everything 的快来自借 Windows 的日志；mac-everything 的快来自把索引的每一层都握在自己手里，代价是权限、内存与持久化全都要自己扛。
