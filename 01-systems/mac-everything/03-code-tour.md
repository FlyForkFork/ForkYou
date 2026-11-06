# 03 代码走读：从入口到核心

> 这篇回答：先读什么、主流程怎么走、加功能改哪里。

## 仓库地图

```text
mac-everything/
├── main.cpp                     # 最小 CLI：扫盘 → loadRecords → 交互查询
├── test_all.cpp                 # 所有 C++ 测试的入口
├── benchmark.cpp                # 核心查询基准
├── Makefile                     # 测试/ASan/TSan/daemon/benchmark
├── MacEverything/
│   ├── Core/                    # 62 个头/源：扫描、索引、查询、WAL、HTTP
│   ├── Bridge/                  # Objective-C++：引擎生命周期 + 分页快照
│   ├── App/                     # SwiftUI：菜单栏面板、设置、高亮、Quick Look
│   └── CLI/                     # MacEverything/CLI/daemon_main.cpp / MacEverything/CLI/mcp_main.cpp
├── tests/                       # 91 个测试文件（C++ + 2 个 Swift）
├── MacEverythingUITests/        # 原生 UI 测试
├── docs/                        # changelog、audits、benchmark 原始数据
└── scripts/                     # scripts/build-dmg.sh、release/*.sh
```

## 构建/运行入口

| 目标 | 命令 | 说明 |
|---|---|---|
| 核心测试 | `make test` | `test_all --fast` + `lint-bridge`（`Makefile:49-52`） |
| 全量测试 | `make test-all` | 含慢速扫描/FSEvents 集成 |
| GUI | `make app` | `xcodebuild -project MacEverything.xcodeproj -scheme MacEverything -configuration Release`（`Makefile:61-64`） |
| 无头 daemon | `make daemon` | 产物 `maceverything-daemon`（`Makefile:18-21`） |
| 分页快照 | `make test-bridge-snapshot` | ObjC++ 分页/快照测试（`Makefile:31-37`） |

`main.cpp` 是理解全链路的最短路径：`DirectoryScanner::scan` → `takeResults` → `SearchEngine::loadRecords` → `query`（`main.cpp:25-69`）。它不做持久化，也没有 FSEvents，但把“扫描-建索引-查询”三件事串起来了。注意：仓库没有 `main.cpp` 的现成 Makefile target；想单独编译它，需要照 `Makefile:12-19` 的 `CXXFLAGS`、`RE2_CFLAGS`、`RE2_LDFLAGS` 与 `-framework CoreServices` 手动把 `test_all.cpp` 换成 `main.cpp`，并先配好 `RE2_PREFIX`。网上常见的 `clang++ -std=c++20 -O2 MacEverything/Core/*.cpp main.cpp` 会因缺 RE2/abseil 与 CoreServices 链接失败，不要直接用。

发版路径单独走 `scripts/build-dmg.sh <arch> <version>`：脚本先构建静态链接的 re2/abseil，再调 `xcodebuild`，最后用 `hdiutil` 生成 `dist/MacEverything-<version>-<arch>.dmg`（`README.md:183-185`、`.github/workflows/pr-build.yml:33-40`）。本地 `make dmg` 只做未签名 DMG，正式发布由 `.github/workflows/release.yml` 在 tag 上构建两种架构并生成 `SHA256SUMS.txt`。

## 主流程走读

### 第 1 步：应用启动，创建常驻 ViewModel

`AppDelegate.applicationDidFinishLaunching` 先初始化日志，再访问 `SearchViewModel.shared`——这一步会触发索引加载与文件监控；随后注册全局快捷键、创建状态栏图标（`MacEverything/App/AppDelegate.swift:19-34`）。应用没有主窗口，`MacEverythingApp` 只有一个用于承载菜单命令的 `Settings` 场景（`MacEverything/App/MacEverythingApp.swift:3-14`）。

### 第 2 步：ServiceEngine 选择“增量启动”还是“全量扫描”

`startIncremental` 先 `IndexPersistence::load()`：优先 v6 `index.v6`，其次 `pages`，最后旧 `index.bin`；若 `lastEventId > 0` 且有记录，立即 `setEngine` 并回调 UI，让搜索先可用；后台再执行 Phase 2 与 `backgroundSyncEngine`（`MacEverything/Core/ServiceEngine.cpp:159-265`）。没有缓存则 `startFullScan`：GCD 后台扫描 + 200 ms 进度回调，扫完 `loadRecords`、启动监控、后台建内容索引（`MacEverything/Core/ServiceEngine.cpp:100-153`）。

### 第 3 步：查询进入 C++ 引擎

Swift 侧 `SearchViewModel` 对普通输入做 80 ms 防抖、对 `infile:` 做 300 ms 防抖；每次新输入取消旧任务（`MacEverything/App/SearchViewModel.swift:223-283`）。真正查询在 `Task.detached` 里调用桥的 `querySnapshot`，失败重试 2 次（`MacEverything/App/SearchViewModel.swift:285-320`）。

C++ 侧 `SearchEngine::query` 先做 `~` 展开和统一小写，再判断是不是 `/path/*` 的目录列出模式；其余全部进入 `queryAdvanced`（`MacEverything/Core/SearchEngineQuery.cpp:148-250`）。

### 第 4 步：解析、选候选、并行扫描

`queryAdvanced` 的顺序是：`QueryParser::parse` → `transformSlashTerms`（把 `a/b/c` 拆成路径段约束）→ `transformGlobTerms`（含 `*`/`?` 转 GLOB）→ `analyzeQueryNeeds` → 预编译 RE2（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:579-609`）。

候选集有三路：名称 trigram、扩展名倒排、目录树路径段扫描；只有候选数 ≤ 总数的 1/10（名称/正则）或 1/4（路径）才会采用，最后取最小集合（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:629-750`）。没有候选集就全量扫描。扫描按 1,024 条检查取消，8 条预取；单条件查询走专用 `simdContains` 循环，复杂条件走 `evalNode`（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:801-848`）。

### 第 5 步：每线程 Top-K，合并后排序

每个 worker 只保留自己最好的 K 条（小顶堆），最后合并再按 `priority → pathLen → idx` 排序（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:760-781,887-898`）。排序前已经释放共享锁，避免长排序阻塞写入（`:883-885`）。

### 第 6 步：桥接层按页物化

`MEQuerySnapshot.resultsAtOffset` 只取当前页的 ID，逐条 `getRecord` 拼成 `MEFileResult`；如果 `generation` 变了，说明索引被压缩/替换，直接返回 false 让 Swift 侧重查（`MacEverything/Bridge/MacSearchBridge.mm:17-32`、`:404-421`）。这就是滚动分页不会长期持锁的原因。

### 第 7 步：内容索引在后台单独跑

`ServiceEngine::startContentIndexing` 遍历已索引文件，只对配置允许的文本类型、且小于 `ContentIndex::maxFileSize_`（1 MiB）的文件抽取 trigram（`MacEverything/Core/ServiceEngine+Content.cpp`、`MacEverything/Core/ContentIndex.cpp:111-138`）。`infile:` 查询走 `ContentIndex::query`：≥3 字符时按 trigram 交集，短词退化为逐文件扫描；结果附带 80 字符上下文 snippet（`MacEverything/Core/ContentIndex.cpp:478-538`）。内容索引不阻塞文件名搜索，也不参与 `SearchEngine` 的共享锁。

### 第 8 步：退出时把 WAL 收干净

`applicationShouldTerminate` 返回 `.terminateLater`，在后台调用 `prepareForTermination`，完成后才允许退出（`MacEverything/App/AppDelegate.swift:46-54`）。C++ 侧 `shutdown` 先 CAS 防重入，停 HTTP、停监控，等后台任务最多 3 秒，最后 `force compact` 两次持久化（`MacEverything/Core/ServiceEngine.cpp:449-502`）。如果进程被强杀，下一次启动会靠 WAL 回放补上最后一次保存之后的操作。

## 先读的 10 个文件

| 顺序 | 文件 | 为什么读 |
|---|---|---|
| 1 | `main.cpp` | 96 行看懂扫描→索引→查询的最小闭环 |
| 2 | `MacEverything/Core/ServiceEngine.h` | 整个服务的对象图与生命周期 |
| 3 | `MacEverything/Core/ServiceEngine.cpp` | 启动、增量、后台同步、关闭的真实顺序 |
| 4 | `MacEverything/Core/SearchEngine.h` | SoA 列、常量、公开 API、锁 |
| 5 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp` | 候选选择、并行扫描、Top-K 排序 |
| 6 | `MacEverything/Core/QueryTokenizer.h` + `MacEverything/Core/QueryParser.cpp` | Everything 风格语法的边界 |
| 7 | `MacEverything/Core/FlatIndexWriter.cpp` | v6 文件格式与原子写 |
| 8 | `MacEverything/Core/IndexPersistence.cpp` + `MacEverything/Core/IndexWAL.cpp` | WAL 何时写、何时压缩 |
| 9 | `MacEverything/Bridge/MacSearchBridge.mm` | Swift 与 C++ 的唯一接缝 |
| 10 | `MacEverything/App/SearchViewModel.swift` | 防抖、分页、取消、焦点节流 |

## 阅读时最容易走错的三条路

第一条是**从 `MacEverything/Core/SearchEngine.cpp` 开始读**：这个文件主要是构造/析构和少量公共方法，真正的查询逻辑分散在 `MacEverything/Core/SearchEngineQuery.cpp`、`MacEverything/Core/SearchEngineAdvancedQuery.cpp`、`MacEverything/Core/SearchEngineIndex.cpp` 三个文件，单看一个会误以为引擎很小。第二条是**把 `MacEverything/Core/SearchEngine.h` 当接口文档**：它有 630 行，包含大量实现细节和私有成员，先看 `MacEverything/Core/ServiceEngine.h` 的对象图更划算。第三条是**直接读 `MacEverything/Core/IndexPersistence.cpp`**：它依赖 `FlatIndexWriter` 的 section 布局和 `IndexWAL` 的格式，先读 `MacEverything/Core/FlatIndexWriter.h` 的 Header/SectionEntry 定义，再回头看刷盘策略，顺序会顺很多。

## 关键类型/函数

| 类型/函数 | 作用 | 位置 |
|---|---|---|
| `ServiceEngine::startIncremental` | 缓存优先启动，立即可搜 | `MacEverything/Core/ServiceEngine.cpp:159-265` |
| `SearchEngine::queryAdvanced` | 查询总调度 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:567-948` |
| `SearchEngine::batchMutate` | FSEvents 批量变更入口 | `MacEverything/Core/SearchEngine.h` 声明；`MacEverything/Core/ServiceEngine+FSEvents.cpp:129-147` 调用 |
| `IndexPersistence::flush` | WAL 轮换 + 全量重写 | `MacEverything/Core/IndexPersistence.cpp:114-200` |
| `MEQuerySnapshot` | 分页快照 | `MacEverything/Bridge/MacSearchBridge.mm:7-32` |
| `DirectoryScanner::scan` | 多线程 `getattrlistbulk` 扫描 | `MacEverything/Core/DirectoryScanner.cpp:43-45,145-164` |
| `QueryParser::parse` | 递归下降 AST | `MacEverything/Core/QueryParser.cpp:9-18` |

理解 `SearchEngine` 的锁要先分清三把锁：`mutex_` 是读写锁，保护所有索引结构；`mutationGate_` 是保存/压缩期间的“写者闸门”，让新写入在序列化时排队；`sessionGenMutex_` 只保护每个 session 的 generation 计数器（`MacEverything/Core/SearchEngine.h:437-444`、`MacEverything/Core/SearchEngineQuery.cpp:256-277`）。查询路径只拿 `shared_lock`，不要在持有它时调用可能写索引的方法，否则会自锁。

## 加一个功能要改哪里

| 想加的功能 | 改动点 | 备注 |
|---|---|---|
| 新过滤器（如 `owner:`） | `MacEverything/Core/QueryTokenizer.h:163-182` 注册；`QueryFilterParser` 解析；`QueryNeedsAnalysis` + `evalNode` 执行 | 三处都要加，否则只解析不生效 |
| 新查询语法（如 `&&`） | `MacEverything/Core/QueryTokenizer.h:33-133`、`MacEverything/Core/QueryParser.cpp`、`MacEverything/Core/QueryAST.h` | 先补 tokenizer 测试 |
| 新元数据列 | `MacEverything/Core/FileRecord.h`、`MacEverything/Core/DirectoryScanner.cpp:145-155`、`MacEverything/Core/SearchEngine.h` SoA、`MacEverything/Core/FlatIndexWriter.h` section、`MacEverything/Core/SearchEngineV6.cpp` | 磁盘格式要升版本或加 section |
| 新 HTTP 路由 | `MacEverything/Core/HttpServer.cpp:375-403` 注册；`handleXxx` 实现；`ServiceEngine` 提供数据 | 保持 JSON 字段向后兼容 |
| 新搜索 UI | `MacEverything/App/SearchViewModel.swift` + `MacEverything/App/ContentView.swift` / `MacEverything/App/ResultRow.swift` | 不要直接碰引擎锁 |

## 测试地图

| 层 | 代表文件 | 覆盖 |
|---|---|---|
| 查询解析/执行 | `tests/test_query_parser.h`、`tests/test_structured_query.h`、`tests/test_query_filters.h`、`tests/test_query_modifiers.h` | tokenizer、AST、过滤器、日期、排序 |
| 索引/持久化 | `tests/test_flat_persistence_v6.h`、`tests/test_wal_crc.h`、`tests/test_wal_batch_replay.h`、`tests/test_memory_optimizations.h` | v6 存读、CRC、WAL 回放、窄列/路径表 |
| 扫描/FSEvents | `tests/test_fsevents.h`、`tests/test_fsevents_batch.h`、`tests/test_rescan_debounce.h`、`tests/test_batch_rescan.h` | 事件翻译、防抖、重扫 |
| 并发/安全 | `tests/test_thread_safety.h`、`tests/test_query_cancel.h`、`tests/test_instance_lock.h` | 多线程、取消、单实例 |
| 桥/UI | `tests/test_query_snapshot.mm`、`tests/test_highlight_ranges.swift`、`tests/test_index_refresh_throttle.swift` | 分页快照、高亮、刷新节流 |
| 性能 | `tests/test_query_perf.h`、`tests/test_query_perf_10m.h`、`benchmark.cpp` | 查询延迟、千万级合成数据 |

测试风格是“单文件、无框架、assert 驱动”：每个 `tests/test_*.h` 暴露一个 `runXxxTests()`，由 `test_all.cpp` 按 Part 编号调用；失败直接打印断言位置并计数，不依赖 GoogleTest。新增测试时先看 `tests/test_helpers.h` 的临时目录/构造记录辅助，再决定放哪个 Part。性能类测试（`test_query_perf*.h`）只在 slow 模式跑，避免日常 `make test` 被拖慢。

运行：`make test` 做快速回归；`make test-asan` / `make test-tsan` 做内存与数据竞争检查；`make test-bridge-snapshot` 单独验证 ObjC++ 分页（`Makefile:31-46`）。

**一句话记住：** 先读 `main.cpp` 建立闭环，再沿 `ServiceEngine → SearchEngine → Bridge → ViewModel` 走一遍，最后才看持久化的细节。
