# mac-everything

> Everything 的 macOS 答案：菜单栏里毫秒级搜全盘文件名。

- **项目**：YuSec2021/mac-everything（fork：FlyForkFork/mac-everything）
- **语言/栈**：C++20 核心 + Objective-C++ 桥 + SwiftUI 外壳，macOS 14+
- **许可证**：MIT
- **分析 commit**：`0db6b601fb0baa6129356fd4416ded034666d4f5`（main，2026-11-09）
- **版本**：1.4.0（Build 4）
- **规模**：439 次提交、534 个文件；Core 62 个 C++ 头/源、22 个 Swift、87 个 `tests/test_*` 测试文件
- **实测口径**：固定快照 6,381,948 条有效记录，就绪物理足迹 573.0 MiB；`*.swift` 0.93 ms、`readme` 6.13 ms（上游 `README.md:241-255`）

## 它解决什么

Spotlight 会“理解”你，却经常不给你想要的那个文件名；Finder 和 `find` 在百万文件面前太慢。MacEverything 常驻菜单栏，按 `Option+Space` 弹出搜索框，直接查本地索引，支持 Everything 风格过滤器、布尔表达式、glob、正则和 `infile:` 内容搜索。

## 怎么做的（一句话）

内存里用 SoA 列 + 名称 trigram / 扩展名倒排 + 目录树，磁盘上用 v6 十一节段扁平文件 + WAL 增量日志，FSEvents 负责实时追赶；查询先选最窄的候选集，再并行扫描并每线程保留 Top-K。

## 文档

| 文档 | 内容 |
|---|---|
| [01-positioning.md](01-positioning.md) | 定位、用户、竞品与项目健康度 |
| [02-architecture.md](02-architecture.md) | 分层、模块地图、主数据流与关键决策 |
| [03-code-tour.md](03-code-tour.md) | 仓库地图、入口、先读文件与测试地图 |
| [04-deep-dive-index-persistence.md](04-deep-dive-index-persistence.md) | v6 扁平文件 + WAL 的写入、恢复与压缩 |
| [04-deep-dive-query-engine.md](04-deep-dive-query-engine.md) | 从查询串到候选集、并行扫描与排序 |
| [04-deep-dive-fsevents-memory.md](04-deep-dive-fsevents-memory.md) | FSEvents 增量索引与 573 MiB 内存账本 |
| [05-performance.md](05-performance.md) | 性能路径、实测数字与瓶颈 |
| [06-branches.md](06-branches.md) | 5 个分支的 SHA、diff 数据与读法 |
| [07-contribute.md](07-contribute.md) | 构建、测试、CI 与第一个 PR |
| [08-takeaways.md](08-takeaways.md) | 可迁移想法 + 10 题双 Agent 模拟面试 |
| [09-ops.md](09-ops.md) | 安装、配置、端口、日志与故障模式 |
| [guide.html](https://flyforkfork.github.io/ForkYou/01-systems/mac-everything/guide.html) | 可交互的单文件导览 |

**一句话记住：** 它不是“又一个搜索框”，而是一套把百万级目录压进内存、再用 trigram 把查询缩到几毫秒的索引系统。
