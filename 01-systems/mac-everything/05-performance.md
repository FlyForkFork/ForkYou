# 05 性能：热路径、复杂度、优化

> 这篇回答什么问题：哪里最贵、为什么贵、优化了什么、哪些数字是实测、哪些只是推断。

## 性能敏感路径

1. **查询时的全表扫描**：任何没有候选集的查询都要遍历 600 万条记录（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:790-791`）。
2. **名称 trigram 交集**：候选越多，`intersectPostingLists` 与后续验证越贵；超过总数 1/10 直接放弃（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:629-639`）。
3. **宽路径查询**：没有路径 trigram 后，只能线性遍历 70 万个目录并展开记录（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:697-722`）。
4. **FSEvents 批量变更**：一次 `batchMutate` 持写锁，期间搜索只能等（`MacEverything/Core/ServiceEngine+FSEvents.cpp:129-147`）。
5. **全量保存**：v6 `fullRewrite` 写约 740 MB，同时要避免阻塞读（`MacEverything/Core/FlatIndexWriter.cpp:354-402`）。
6. **启动 Phase 2**：为 638 万条名称建 trigram，实测约 9 秒，但放在锁外（`MacEverything/Core/SearchEngineV6.cpp:60-126`）。

## 复杂度

| 路径 | 时间复杂度 | 空间 |
|---|---|---|
| 名称 trigram 查询 | O(Σ posting 长度 + 候选数 × 名字长度) | 倒排表常驻约 139.3 MiB posting（`memory-next` 轮） |
| 纯元数据过滤 | O(records) 并行，`simdTypeLive16` 一次 16 条 | 无候选数组 |
| 扩展名查询 | O(posting 长度) | 扩展名 → 记录号 |
| 路径段查询 | O(目录数 × 段数 + 命中目录下记录数) | 候选数组，上限 total/4 |
| 单条更新 | O(名字 trigram 数 + 路径表探测) | 原地更新 |
| 批量删除 | O(k log k + Σ 受影响 posting) | 排序后的删除索引 |
| v6 保存 | O(records + bytes) | 临时文件约 740 MB |
| 前缀删除 | O(目录数) + O(命中记录 × trigram 维护) | 无额外大缓冲 |

## 关键常量/缓冲区

| 常量 | 值 | 位置 | 作用 |
|---|---:|---|---|
| `kRecordsPerPage` | 1024 | `MacEverything/Core/SearchEngine.h:263` | 每页记录数/取消检查粒度 |
| `kBatchIndexRemoval` | 64 | `MacEverything/Core/SearchEngine.h:286` | 批量删除走倒排表分组的阈值 |
| `kRecentCacheSize` | 200 | `MacEverything/Core/SearchEngine.h:565` | 最近文件缓存上限 |
| `kMaxWALSize` | 50 MB | `MacEverything/Core/IndexWAL.h:74` | WAL 上限，超了 `append` 返回 false |
| `kCompactThreshold` | 100 条目 | `MacEverything/Core/IndexPersistence.h:38` | 少于 100 条不写盘 |
| `kCheckIntervalSec` | 60 s | `MacEverything/Core/IndexPersistence.h:70` | 自动刷盘检查间隔 |
| `kMinRewriteIntervalSec` | 15 min | `MacEverything/Core/IndexPersistence.h:71` | 两次全量重写最短间隔 |
| `kMaxRewriteIntervalSec` | 2 h | `MacEverything/Core/IndexPersistence.h:72` | 超过则普通重写 |
| `kWALSoftFlushBytes` | 8 MB | `MacEverything/Core/IndexPersistence.h:73` | 软刷盘阈值 |
| `kWALUrgentFlushBytes` | 32 MB | `MacEverything/Core/IndexPersistence.h:74` | 强制刷盘阈值 |
| `kTombstoneCompactRatio` | 0.25 | `MacEverything/Core/IndexPersistence.h:84` | tombstone 超 25% 直接全量压缩 |
| `kDeadSpaceRewriteRatio` | 0.5 | `MacEverything/Core/IndexPersistence.h:85` | 死空间比例阈值 |
| 扫描线程 | 4–32 | `MacEverything/Core/DirectoryScanner.cpp:15-69` | `hardware_concurrency` 截断 |
| 扫描 buffer | 1 MB/线程 | `MacEverything/Core/DirectoryScanner.cpp:13` | `getattrlistbulk` 批量缓冲 |
| 查询线程 | 1–32（<1 万候选单线程） | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:790-791` | 工作量决定并行度 |
| 查询取消检查 | 每 1024 条 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:807` | 用 generation 比较取消 |
| 重扫 debounce / 节流 | 5 s / 300 s | `MacEverything/Core/ServiceEngine.h:173-174` | 目录级重扫限流 |
| 日志轮转 | 5 MB | `MacEverything/Core/Logger.h:64` | 单文件上限 |
| 内容索引文件上限 | 1 MB（可配 0.1–10 MB） | `MacEverything/Core/ContentIndex.h:144` | `infile:` 只索引小文本 |

测量口径要分清三层：**核心引擎**（`benchmark`/`test_query_perf`，Release/O2，不含桥接）；**桥接分页**（`tests/test_query_snapshot.mm`，含 ObjC 对象物化）；**端到端 GUI**（含 80 ms 防抖、SwiftUI 绘制、焦点检查）。README 的 0.93 ms/6.13 ms 是第一层；用户按快捷键到看到结果还会叠加防抖与首屏绘制，不能直接拿这个数字当“体感延迟”。

## 基准/实测

**查询延迟（固定快照 6,381,948 条有效记录，Release/O2，5 次中位数，上限 10,000）**

| 查询 | 耗时 | 执行方式 | 结果数 |
|---|---:|---|---:|
| `*.swift` | 0.93 ms | 名称 trigram | 1,145 |
| `readme` | 6.13 ms | 名称 trigram | 10,000 |
| `size:>1mb` | 2.12 ms | SoA 并行过滤 | 10,000 |
| `type:folder` | 2.09 ms | SoA 并行过滤 | 10,000 |
| `path:MacEverything ext:swift` | 0.049 ms | 扩展名索引 | 81 |
| `/Applications/` | 5.37 ms | DIR_LIST 捷径 | 13 |
| `MacEverything/a` | 34.62 ms | 目录扫描 + 记录展开 | 632 |
| `com.apple.Safari/a` | 34.03 ms | 目录扫描 + 记录展开 | 3,930 |
| `site-packages/a` | 49.96 ms | 目录扫描 + 记录展开 | 10,000 |
| `my_product/a` | 57.95 ms | 目录扫描 + 记录展开 | 10,000 |

来源：`docs/audits/2026-10-22/path-table-dir-runs/after.txt`（同目录 `report.md` 给出快照指纹 46b8eb2f7e52153d），README 的 `README.md:241-255` 引用的就是这一组。全部是核心引擎测量，不含 GUI 防抖、桥接和绘制。

**查询临时内存（win-inspired 轮，独立进程，1 ms 采样峰值）**

| 查询 | 前额外占用 | 后额外占用 | 前进程峰值 | 后进程峰值 |
|---|---:|---:|---:|---:|
| `size:>=0` | 179.24 MiB | 2.36 MiB | 1443.69 MiB | 1266.77 MiB |
| `!zzzz-memory-check-absent-12938` | 187.16 MiB | 2.82 MiB | 1451.41 MiB | 1269.52 MiB |

来源：`docs/audits/2026-10-22/win-inspired/report.md:48-58`。Top-K 把“无上限候选缓冲”变成“每线程 K 条”，这是这一轮最直接的收益。

**内存（7 轮独立实验，不可拼成一次端到端）**

| 轮次 | 优化前 | 优化后 | 查询代价 |
|---|---:|---:|---|
| 路径表 hash+编号 | 3712.61 MiB | 2372.72 MiB | 基本不变 |
| 只读列 + 流式 CRC + B-tree | 2304.39 MiB | 1943.39 MiB | 基本不变 |
| 24 位倒排 + 预分配 | 1903.00 MiB | 1882.89 MiB | 基本不变 |
| 移除路径 trigram | 1885.88 MiB | 1573.28 MiB | `MacEverything/a` 0.23→51.14 ms |
| 目录树 + 名称共享 + 差分 | 1573.03 MiB | 1268.56 MiB | `readme` 2.057→6.290 ms |
| 列收窄 + 分配器 | 1266.88 MiB | 708.25 MiB | 噪声内 |
| 4B 路径表 + 目录分段 | 702.3 MiB | **573.0 MiB** | 噪声内，`indexForPath` 1.06→1.33 µs |

最后一行还附带了结构明细：`pathIndex_` 63.9→34.4、`pathIdxToRecords_` 46.7→8.1、固定字段 SoA 135.6→80.1 MiB；Phase 2 完成 11.2→9.0 s，加载完成 473.2→387.9 MiB（`docs/audits/2026-10-22/path-table-dir-runs/report.md:25-38`）。

**批量删除（41,562 条，`/System/Library/Frameworks`）**

| 版本 | 耗时 |
|---|---:|
| 逐条维护倒排表 | 1396.9 / 1430.1 ms |
| 按 trigram 分组一次 `eraseSorted` | **245.7 / 252.8 ms** |

来源：`docs/audits/2026-10-22/batch-index-removal/report.md:22-30`。README 说的“1.4 s→0.25 s”就是这一组；前缀删除那轮的 5709→4719 ms 是更早基线、包含不同目录，不是同一组数字（`docs/audits/2026-10-22/path-table-dir-runs/report.md:53-55`）。

**保存与并发（同一轮对照，100 次合成更新）**

| 指标 | 前 | 后 |
|---|---:|---:|
| 保存用时 | 262.5 ms | 120.2 ms |
| 保存期间搜索最长耗时 | 123.2 ms | 0.89 ms |
| 保存及更新阶段峰值 | 3424.83 MiB | 2472.92 MiB |
| 单次更新最长耗时 | 127.9 ms | 151.2 ms |

来源：`docs/audits/2026-10-21/memory-optimization-2/report.md:9-15`。注意最后一行：**单次更新反而变慢了**，因为写入被挡在序列化之外排队。这不是退步，是取舍。

## 优化手法

| 手法 | 解决的问题 | 代价 |
|---|---|---|
| 名称 trigram + 扩展名索引 | 把全表扫描缩成候选验证 | 建索引约 9 s（Phase 2）、posting 常驻 139.3 MiB |
| 候选集竞争（name/regex/path/ext 取最小） | 单一索引在宽查询上失效 | 多路都要算，逻辑复杂 |
| 每线程 Top-K 小顶堆 | 并行结果合并的内存峰值 | K 很小时可能频繁替换 |
| `simdContains` + 16 路 liveness | 字符串比较和空记录跳过 | 仅 ARM NEON 有完整优化 |
| 名称命中后不拼路径 | 每候选一次 `path + "/" + name` 分配 | 需要 `nameOnly` 分析正确，否则漏匹配 |
| 批量 `eraseSorted` | 每条删除都移动整张倒排表 | 只对 ≥64 条生效，小批量走原路径 |
| 窄列 + 旁表 | 64 位字段常驻太贵 | 溢出值查询要走旁表 |
| 目录池共享前缀 | 完整路径字符串重复 | 路径还原有 CPU 成本（`indexForPath` 1.06→1.33 µs） |
| Phase 2 锁外建索引 | 启动时长时间阻塞搜索 | 未完成时查询退化 |
| `MallocLargeCache=0` | libmalloc 保留 361 MiB 脏页 | 平台特有，换环境不复现 |
| 压缩单飞 + 代际校验 | 并发压缩互相覆盖 | 后到者直接放弃，压缩可能延迟 |

## 瓶颈与反例

- **宽路径查询仍是弱点**：`MacEverything/a` 34.62 ms、`my_product/a` 57.95 ms，比热查询慢 30–60 倍。路径段扫描是线性目录遍历，不是 trigram。
- **内存优化可能让查询变慢**：目录树那轮 `readme` 从 2.057 涨到 6.290 ms，`MacEverything/a` 从 56.127 涨到 123.386 ms（`docs/audits/2026-10-22/memory-next/report.md:36-46`）；路径表那轮查询差异在噪声内，`indexForPath` 甚至从 1.06 变慢到 1.33 µs（`docs/audits/2026-10-22/path-table-dir-runs/report.md:44-51`）。
- **保存写放大没解决**：每次全量重写约 740 MB（740,159,038 字节，`docs/audits/2026-10-22/path-table-dir-runs/report.md:60`），项目自己在审计里明确“未解决”。
- **保存期间更新会排队**：最长 151 ms（`memory-optimization-2`）到 942 ms（`memory-next`，含等待保存），不同磁盘差异很大。
- **短时 GUI 观察**：600–612 MB 只是启动后 3.5 分钟的采样，不能当作长期驻留保证（`docs/audits/2026-10-22/path-table-dir-runs/report.md:79-92`）。
- **“删除 0.25s”只适用于批量路径**：单条删除、更新、WAL 回放、压缩仍走逐条路径（`docs/audits/2026-10-22/batch-index-removal/report.md:46-52`）。
- **TSan 历史**：路径表轮报告 1 处 `__block` 数据竞争（`queryAdvanced` 的 `dispatch_apply` 结果数组），HEAD 上同样复现，后由 `110ed3b` 修复；但 `memory-optimization-2` 轮的 TSan 套件里有一条 `batchRescanPrefix` 相对耗时断言失败（旧方式 1155.59 ms、新方式 1033031.07 ms），原因未查明。不能笼统写“TSan 全绿”。
- **推断：正则查询的多线程收益依赖 clone**：源码注释称共享 RE2 对象时 12 线程比 1 线程慢约 6 倍，每线程 clone 后约 3.8 倍加速（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:108-126`）。这是作者本机实测注释，没有对应的独立审计报告，引用时应标注来源为代码注释。

## 读这些数字时的四个坑

1. **七轮内存数字不能相加**：每轮都是同一快照上的独立前后对比，优化对象有重叠；把 3712.61−573.0 说成“省了 3.1 GiB”没有意义。要看单轮的前后值和最终结构明细。
2. **footprint 不是 RSS**：573.0 MiB 是 Mach 物理足迹；GUI 的 600–612 MB 只是启动后 3.5 分钟的采样，vmmap 峰值 834.3 MB 又是另一个口径。三个数不能混着引用。
3. **数字绑死机器和快照**：6,381,948 条有效记录、SHA-256 前缀 46b8eb2f7e52153d、作者本机；换一台机器、换一块磁盘、换权限范围，绝对值和排序都会变，只能比较同一轮的前后。
4. **查询延迟不含 GUI**：0.93 ms/6.13 ms 是核心引擎 Release/O2 的 5 次中位数，不含 80 ms 防抖、桥接物化和 SwiftUI 绘制；用户体感延迟一定更高。反过来，也不能拿体感慢来否定引擎的候选选择。

## 一条没被平均掩盖的退化

同一轮 `memory-optimization-2` 里，保存耗时从 262.5 ms 降到 120.2 ms、保存期间搜索最长耗时从 123.2 ms 降到 0.89 ms，看起来全是收益；但同一张表的最后一行是“单次更新最长耗时 127.9→151.2 ms”。原因是保存被挪到锁外后，更新要排队等序列化完成。换到共享存储的实验更明显：保存 0.145→0.922 s、单次更新最长等待 177→942 ms（`docs/audits/2026-10-22/memory-next/report.md:36-46`）。

所以读性能表要同时看平均值、P 最大值和“被牺牲的那条路径”；这个项目多次用查询延迟换内存、用更新延迟换保存吞吐，单看任何一个指标都会得出相反的结论。

## 如何自己复测

```bash
# 核心查询基准（固定快照路径需自行准备 v6 文件）
make benchmark

# 全量回归（含性能类 slow 测试）
make test-all

# 内存与并发（ASan / TSan）
make test-asan
make test-tsan
```

审计脚本在 `docs/audits/<date>/<topic>/` 下，多数是独立的 `*.cpp`（如 `path-table-dir-runs/breakdown.cpp`、`mutbench.cpp`、`savecheck.cpp`），只使用公开 API，不修改用户索引。复现时要注意：**必须设置 `MallocLargeCache=0`**，否则测出来的足迹会包含 libmalloc 保留的脏页，数字偏高（`docs/audits/2026-10-22/allocator-narrow-columns/report.md:11`）。

**一句话记住：** 这个项目的性能来自“候选集缩圈 + 列式扫描 + 每线程 Top-K”，而不是某个单点魔法；宽路径查询和全量保存仍是明确的成本中心，而且多次内存优化是用查询延迟换来的。
