# 01 定位：mac-everything 是什么

> 这篇回答：它是什么、谁用、解决什么痛点、凭什么值得学。

## 一句话

mac-everything 是把 Windows 上 Everything 的“输入即出结果”体验搬到 macOS 的菜单栏文件搜索工具：C++20 引擎维护全盘索引，SwiftUI 只负责一层很薄的交互壳（`README.md:8-9`、`MacEverything/App/AppDelegate.swift:6-8`）。

## 谁在什么场景下用它

- 开发者：记得文件名但忘了在哪个目录，按 `Option+Space` 直接搜 `ext:swift` 或 `MacEverything/a`。
- 运维/数据工作者：在几百万个文件里按 `size:>1mb`、`dm:today`、`path:` 组合过滤。
- 自动化场景：通过 `localhost:19860` 的 HTTP API 或 MCP 工具给脚本/AI 编程助手提供文件检索（`README.md:125-155`、`MacEverything/Core/HttpServer.cpp:375-403`）。
- 不想开 Finder、也不想等 Spotlight 转圈的人：它常驻菜单栏、不占 Dock，再次按快捷键就关闭并回到原应用（`MacEverything/App/AppDelegate.swift:142-165`）。

## 没有它之前，人们怎么做

1. **Spotlight**：按 `Cmd+Space` 搜，但结果按系统排序，文件名精确匹配经常排在后面；索引范围不可见。
2. **Finder 搜索**：输入后要等系统遍历，条件组合弱，百万文件时体验接近“卡住”。
3. **终端 `find` / `fd`**：每次查询都重新遍历目录，`fd` 虽快但没有常驻全盘索引，冷启动仍受目录规模限制（外部来源：fd README）。
4. **Raycast/Alfred**：启动器体验好，但文件搜索主要复用 Spotlight 元数据索引，粒度与可控性有限。

## 它解决的三个痛点

| 痛点 | 具体表现 | 这个项目的做法 |
|---|---|---|
| 搜得慢 | Spotlight/Finder 在百万文件下延迟不可控 | 名称 trigram + 扩展名倒排索引先缩候选，再并行扫描（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:629-750`） |
| 搜不准 | 文件名包含、前缀、glob、正则混在一起 | 完整 AST：`tokenize → parse → transform → eval`，支持 30+ 过滤器（`MacEverything/Core/QueryTokenizer.h:163-182`、`MacEverything/Core/QueryParser.cpp:32-139`） |
| 搜不全 | 系统索引排除了某些目录，或只索引元数据 | 自己扫 `/`，记录文件名/路径/类型/大小/修改时间，内容搜索另建 trigram 索引（`MacEverything/Core/DirectoryScanner.cpp:145-164`、`MacEverything/Core/ContentIndex.h`） |

## 竞品对比

| 方案 | 定位 | 核心差异 | License | 成熟度 |
|---|---|---|---|---|
| **Everything** | Windows 文件名搜索标杆 | 只支持 Windows；NTFS 的 USN Journal 让索引近乎零成本；macOS 无法复刻 | MIT 风格（`voidtools.com/License.txt`） | 1.4.1 稳定，1.5 beta |
| **Spotlight** | macOS 系统级元数据搜索 | 系统内置、覆盖全；但排序不可控、不能按“文件名包含”精确控制，也没有 trigram 候选机制 | 闭源，随 macOS 提供 | 系统级，最成熟 |
| **Raycast / Alfred** | 启动器 + 工作流 | 交互和扩展生态强；文件搜索依赖系统索引，不是自建全盘索引 | 闭源商业软件（免费版 + Pro 订阅） | 高 |
| **fd** | 命令行 `find` 替代品 | Rust 并行遍历、语法友好；无持久索引，每次查询重新扫目录 | MIT / Apache-2.0 双许可 | 高 |
| **mac-everything** | macOS 菜单栏 Everything | 自建内存索引 + 磁盘 v6/WAL + FSEvents；C++20 + SwiftUI；同时提供 GUI/HTTP/MCP | MIT | 个人项目，v1.2 Build 3 |

差异的关键不是“谁快”，而是**索引所有权**：Everything 借操作系统日志，Spotlight 借系统元数据，Raycast/Alfred 借 Spotlight；mac-everything 自己扫、自己存、自己增量维护，所以能在 macOS 上控制候选集与排序。代价是要自己处理权限、内存和持久化。

## 为什么是现在

- macOS 14+ 的 FSEvents、`getattrlistbulk` 与 Apple Silicon NEON 都已稳定，能在用户态做到“扫一次、之后只处理增量”。
- 638 万条记录的索引能压到 573 MiB 物理足迹（`docs/audits/2026-10-22/path-table-dir-runs/report.md:25-40`），这是“常驻菜单栏”可行的前提。
- AI 编程工具需要本地文件上下文，MCP/HTTP 让同一引擎多出一种分发方式（`README.md:125-155`）。

## 项目健康度

| 指标 | 值 | 日期 |
|---|---|---|
| 提交数 | 432 | 2026-11-06 |
| 文件数 | 529（Core 62 个 C++ 头/源，22 个 Swift） | 2026-11-06 |
| 测试文件 | 91 个（C++ 回归 + 2 个 Swift 测试） | 2026-11-06 |
| Star | 1 | 2026-11-07 |
| 分支 | 7（仅 `claude/release-workflow` 未合并） | 2026-11-07 |
| 版本 | 1.2（Build 3），`MacEverything/Info.plist:17-20` | 2026-11-06 |
| License | MIT（`LICENSE`、`README.md:339-341`） | 2026-11-06 |

风险：单人项目、star 少、长期维护未知；`MacEverything/Core/ServiceEngine.h:170` 的 `kAppVersion` 仍是 `"1.1.0"`，与 `README.md` 和 `MacEverything/Info.plist` 的 1.2 不一致，属于元数据残留，不是功能缺陷（以代码为准记录）。

## 应用地址

- 上游：https://github.com/YuSec2021/mac-everything
- Fork：https://github.com/FlyForkFork/mac-everything
- 本地源码：`D:\FlyForkFork\mac-everything`
- 本分析：`ForkYou/01-systems/mac-everything/`

## 一句话结论

它用“自建索引”换来了对搜索质量和延迟的完全控制，是学习 macOS 全盘索引系统的一个完整样本。

**一句话记住：** Everything 的快来自借 Windows 的日志；mac-everything 的快来自把索引的每一层都握在自己手里。

## 来源

1. [YuSec2021/mac-everything README](https://github.com/YuSec2021/mac-everything)（2026-11-06）
2. [voidtools Everything 官方站](https://www.voidtools.com/)（2026-11-07）
3. [Apple 支持：在 Mac 上通过“聚焦”查找所需内容](https://support.apple.com/guide/mac-help/search-with-spotlight-mchlp1008/mac)（2026-11-07）
4. [sharkdp/fd README](https://github.com/sharkdp/fd)（2026-11-07）
5. [Raycast Pricing](https://www.raycast.com/pricing)（2026-11-07）
