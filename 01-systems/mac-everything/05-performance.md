# 05 性能：热路径、复杂度、优化

> 这篇回答：哪里最贵、为什么贵、怎么优化、有没有实测。

## 性能敏感路径

1. **查询时的全表扫描**：任何没有候选集的查询都要遍历 600 万条记录（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:789-791`）。
2. **名称 trigram 交集**：候选越多，`set_intersection` 和后续验证越贵（`MacEverything/Core/SearchEngineIndex.cpp:10-43`）。
3. **FSEvents 批量变更**：一次 `batchMutate` 持写锁，期间搜索只能等（`MacEverything/Core/ServiceEngine+FSEvents.cpp:129-147`）。
4. **全量保存**：v6 `fullRewrite` 写约 712 MiB，同时要避免阻塞读（`MacEverything/Core/FlatIndexWriter.cpp:354-402`）。
5. **启动 Phase 2**：为 638 万条名称建 trigram，约 3 秒量级，但项目把它放到锁外（`MacEverything/Core/SearchEngineV6.cpp:60-126`）。

## 复杂度

| 路径 | 时间复杂度 | 空间 |
|---|---|---|
| 名称 trigram 查询 | O(Σ posting 长度 + 候选数 × 名字长度) | 倒排表常驻，约 1–2 B/posting |
| 纯元数据过滤 | O(records) 并行，`simdTypeLive16` 一次 16 条 | 无候选数组 |
| 扩展名查询 | O(posting 长度) | 扩展名 → 记录号 |
| 路径段查询 | O(目录数 × 段数 + 命中目录下记录数) | 候选数组，上限 total/4 |
| 单条更新 | O(名字 trigram 数 + 路径表探测) | 原地更新 |
| 批量删除 | O(k log k + Σ 受影响 posting) | 排序后的删除索引 |
| v6 保存 | O(records + bytes) | 临时文件约 712 MiB |

## 关键常量/缓冲区

| 常量 | 值 | 位置 | 作用 |
|---|---:|---|---|
| `kRecordsPerPage` | 1024 | `MacEverything/Core/SearchEngine.h:262` | 每页记录数/分块粒度 |
| `kBatchIndexRemoval` | 64 | `MacEverything/Core/SearchEngine.h` | 批量删除走倒排表分组的阈值 |
| `kRecentCacheSize` | 200 | `MacEverything/Core/SearchEngine.h` | 最近文件缓存上限 |
| `kMaxWALSize` | 50 MB | `MacEverything/Core/IndexWAL.h` | WAL 上限，超了触发全量重写 |
| WAL fsync 间隔 | 64 条 | `MacEverything/Core/IndexWAL.cpp:127-185` | 平衡吞吐与崩溃丢失窗口 |
| `kCompactThreshold` | 100 条目 | `MacEverything/Core/IndexPersistence.h` | 少于 100 条不写盘 |
| `kWALSoftFlushBytes` | 8 MB | `MacEverything/Core/IndexPersistence.h` | 软刷盘阈值 |
| `kWALUrgentFlushBytes` | 32 MB | `MacEverything/Core/IndexPersistence.h` | 强制刷盘阈值 |
| `kTombstoneCompactRatio` | 0.25 | `MacEverything/Core/IndexPersistence.h` | tombstone 超过 25% 直接全量压缩 |
| `kDeadSpaceRewriteRatio` | 0.5 | `MacEverything/Core/IndexPersistence.h` | 死空间比例阈值 |
| 扫描线程 | 4–32 | `MacEverything/Core/DirectoryScanner.cpp:43-45` | `hardware_concurrency` 截断 |
| 扫描 buffer | 1 MB/线程 | `MacEverything/Core/DirectoryScanner.cpp:13` | `getattrlistbulk` 批量缓冲 |
| 查询线程 | 1–32 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:791` | 候选 <1 万单线程 |
| 查询取消检查 | 每 1024 条 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:806` | 用 generation 比较取消 |

测量口径要分清三层：**核心引擎**（`benchmark`/`test_query_perf`，Release/O2，不含桥接）；**桥接分页**（`tests/test_query_snapshot.mm`，含 ObjC 对象物化）；**端到端 GUI**（含 80 ms 防抖、SwiftUI 绘制、焦点检查）。README 的 0.93 ms/6.13 ms 是第一层；用户按快捷键到看到结果还会叠加防抖与首屏绘制，不能直接拿这个数字当“体感延迟”。

## 基准/实测

**查询延迟（固定快照 6,381,948 条有效记录，Release/O2，中位数）**

| 查询 | 耗时 | 执行方式 |
|---|---:|---|
| `*.swift` | 0.93 ms | 名称 trigram |
| `readme` | 6.13 ms | 名称 trigram |
| `size:>1mb` | 2.12 ms | SoA 并行过滤 |
| `type:folder` | 2.09 ms | SoA 并行过滤 |
| `path:MacEverything ext:swift` | 0.05 ms | 扩展名索引 |
| `MacEverything/a` | 34.62 ms | 目录扫描 + 记录展开 |
| `site-packages/a` | 49.96 ms | 目录扫描 + 记录展开 |

来源：`README.md:241-255`，原始数据在 `docs/audits/2026-10-22/path-table-dir-runs/after.txt`。这些是核心引擎测量，不含 GUI 防抖、桥接和绘制。

**内存（独立轮次，不可拼成一次端到端）**

| 轮次 | 优化前 | 优化后 |
|---|---:|---:|
| 列收窄 + 32 位 hash + 分配器 | 1266.88 MiB | 708.25 MiB |
| 路径表 + 目录分段 + 去 inode/devId | 702.3 MiB | 573.0 MiB |
| Phase 2 加载耗时 | 11.2 s | 9.0 s |

**批量删除（41,562 条，`/System/Library/Frameworks`）**

| 版本 | 耗时 |
|---|---:|
| 逐条维护倒排表 | 1396.9 / 1430.1 ms |
| 按 trigram 分组一次 `eraseSorted` | **245.7 / 252.8 ms** |

来源：`docs/audits/2026-10-22/batch-index-removal/report.md:23-31`。README 说的“1.4s→0.25s”就是这一组；另一份路径表报告里的 `removeByPathPrefix` 5709→4719 ms 是更早基线、包含不同目录，不是同一组数字（`docs/audits/2026-10-22/path-table-dir-runs/report.md:53-55`）。

## 优化手法

| 手法 | 解决的问题 | 代价 |
|---|---|---|
| 名称 trigram + 扩展名索引 | 把全表扫描缩成候选验证 | 建索引约 3 s、常驻约 689 MiB 倒排（`docs/audits/2026-10-21/memory-optimization-2/report.md:62`） |
| 候选集竞争（name/path/ext 取最小） | 单一索引在宽查询上失效 | 三路都要算，逻辑复杂 |
| 每线程 Top-K 小顶堆 | 并行结果合并的内存峰值 | K 很小时可能频繁替换 |
| `simdContains` + 16 路 liveness | 字符串比较和空记录跳过 | 仅 ARM NEON 有完整优化 |
| 批量 `eraseSorted` | 每条删除都移动整张倒排表 | 只对 ≥64 条生效，小批量走原路径 |
| 窄列 + 旁表 | 64 位字段常驻太贵 | 溢出值查询要走旁表 |
| 目录池共享前缀 | 完整路径字符串重复 | 路径还原有 CPU 成本（`indexForPath` 1.06→1.33 µs） |
| Phase 2 锁外建索引 | 启动时长时间阻塞搜索 | 未完成时查询退化 |

## 瓶颈与反例

- **宽路径查询仍是弱点**：`MacEverything/a` 34.62 ms、`site-packages/a` 49.96 ms，比热查询慢 30–50 倍。路径段扫描是线性目录遍历，不是 trigram。
- **内存优化不等于查询更快**：路径表报告明确说查询耗时差异在噪声内（`docs/audits/2026-10-22/path-table-dir-runs/report.md:44`）；`indexForPath` 甚至从 1.06 µs 变慢到 1.33 µs（`:50`）。
- **保存写放大没解决**：每次全量重写约 712 MiB，SSD 写入寿命和保存时延都受限（`docs/audits/2026-10-21/memory-optimization-2/report.md:61`）。
- **短时 GUI 观察**：600–612 MB 只是启动后 3.5 分钟的采样，不能当作长期驻留保证（`docs/audits/2026-10-22/path-table-dir-runs/report.md:90-92`）。
- **“删除 0.25s”只适用于批量路径**：单条删除、更新、WAL 回放、压缩仍走逐条路径（`docs/audits/2026-10-22/batch-index-removal/report.md:48-49`）。

**一句话记住：** 这个项目的性能来自“候选集缩圈 + 列式扫描 + 每线程 Top-K”，而不是某个单点魔法；宽路径查询和全量保存仍是明确的成本中心。
