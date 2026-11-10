# 04 深挖三：FSEvents 增量索引与内存优化

> 这篇回答什么问题：索引怎样跟上文件系统变化，又怎样把 638 万条记录压到 573 MiB，以及这套压缩在哪些场景下会失效。

## 问题

全盘索引有两个长期成本：

1. **新鲜度**：文件每秒都在变，不能靠定时全盘重扫。
2. **驻留内存**：600 万条记录，每条若存完整路径 + 原始名 + 小写名 + 多个 64 位字段，轻松超过 1 GiB。

FSEvents 负责第一件事，列式/池化/窄列负责第二件事。两者必须同时成立，否则“常驻菜单栏”就不成立。

## 朴素做法为什么不够

| 做法 | 问题 |
|---|---|
| 每 5 分钟全盘重扫 | 磁盘一直转，CPU 一直高，笔记本续航崩 |
| 每条 FSEvent 立即改索引 | 事件风暴下锁竞争严重，搜索被写锁饿死 |
| 每条记录存完整路径字符串 | 路径前缀大量重复，600 万条 × 平均 80 字节 ≈ 480 MiB |
| `unordered_map<string, record>` | 每个节点一次堆分配 + 字符串分配，malloc 碎片巨大 |
| 所有元数据都用 64 位 | sizes/modTimes 大部分落在 32 位范围，纯浪费 |

## 这个项目怎么做

### FSEvents：先翻译，再批量应用

`FileSystemWatcher` 用 `FSEventStreamCreate` 订阅文件事件：`sinceEventId` 从上次位置开始，0.3 秒合并窗口，flags 含 `FileEvents | NoDefer | UseCFTypes | IgnoreSelf`（`MacEverything/Core/FileSystemWatcher.cpp:52-63`）。回调里跳过 `RootChanged`/`Unmount`，`HistoryDone` 触发 `onReplayDone`；`MustScanSubDirs` 如果落在排除目录（`.Spotlight-V100`、`.fseventsd`、`.Trashes`、`private/var/folders` 下的 `com.apple.*`）的祖先上就忽略，否则置 `journalTruncated_` 并提前中止回放（`MacEverything/Core/FileSystemWatcher.cpp:112-213`、`:177-192`）。

`ServiceEngine::collectFSEventMutations` 把一批事件翻译成三类输出（`MacEverything/Core/ServiceEngine+FSEvents.cpp:44-123`）：

- `MustScanSubDirs` → `rescanDirs`；
- 删除/移走 → 目录记 `REMOVE_TREE` 整树删除，文件记 `REMOVE`；事件没带类型标志时查索引判断原类型（`:74-79`）；
- rename 进来的目录 → `rescanDirs`；
- 同一批里已被 `REMOVE_TREE` 覆盖的子路径，后续 op 直接丢掉，避免重复（`:104-121`）。

`applyFSEvents` 先处理内容索引更新，再调 `engine->batchMutate`，整批只加一次锁（`MacEverything/Core/ServiceEngine+FSEvents.cpp:129-147`）。目录级重扫不立即执行，而是 `scheduleRescanForPaths` 做 5 秒 debounce（`:225-249`）、`flushPendingRescans` 做 300 秒节流（`:251-315`，常量在 `MacEverything/Core/ServiceEngine.h:173-174`）；重扫只替换目录内容并补回目录自身记录（`:317-334`）；`rescanSubtree` 在 tombstone 超过 30% 时顺手 `compactRecords` 并 remap 内容索引（`:336-364`）。

**为什么必须先翻译再批量应用？** 因为事件语义和索引语义不是一一对应的：一次目录 rename 在 FSEvents 里可能是“旧路径删除 + 新路径创建 + 一堆子项 MustScanSubDirs”，如果逐条执行，索引会在中间态停留很久，而且每条都要抢写锁。翻译层把这些压成“一条 REMOVE_TREE + 一个 rescanDir”，核心只需要处理领域操作。

### 内存：六层压缩

| 层 | 做法 | 收益（同快照对照） |
|---|---|---|
| 路径查找表 | 完整路径字符串 → 32 位 hash + 编号，真实字符串留在 StringPool | 第一轮就把就绪足迹从 3712.61 降到 2372.72 MiB（`docs/audits/2026-10-21/memory-optimization/report.md:19-23`） |
| 目录池 | 目录按组件建树，子目录只存 `parent` + 本段字节；`matchesSegments` 沿父链右向左匹配 | 路径前缀去重（`MacEverything/Core/DirectoryPool.h:9-52`、`:128-143`） |
| 名称池 | 原始名与小写名共享同一段字节（相同则同偏移） | 常见全小写文件名省一半（`MacEverything/Core/FoldedNamePool.h:5-38`） |
| 倒排表 | 24 位记录编号 + varint 差分 + 每 128 条一个稀疏 checkpoint | 两类倒排 689.3 → 517.0 MiB（`docs/audits/2026-10-21/memory-optimization-3/report.md:17-22`） |
| 窄列 | `sizes_`/`modTimes_` 用 32 位，溢出值进 `absl::btree_map` 旁表；`devIds_` 1 字节字典 | 两列各 49.3 → 24.6 MiB，设备号 24.6 → 6.2 MiB（`docs/audits/2026-10-22/allocator-narrow-columns/report.md:35-39`） |
| 路径表 + 目录分段 | 开放寻址表每槽只存 4 字节记录号；目录→记录改为 CSR 连续段 + 尾列表 | `pathIndex_` 63.9→34.4、`pathIdxToRecords_` 46.7→8.1 MiB（`docs/audits/2026-10-22/path-table-dir-runs/report.md:33-38`） |

### 内存账本（同一份固定快照，7 轮独立实验）

| 轮次 | 优化前 | 优化后 | 来源 |
|---|---:|---:|---|
| 路径查找表 hash+编号 | 3712.61 MiB | 2372.72 MiB | `docs/audits/2026-10-21/memory-optimization/report.md:19-23` |
| 只读列借用 + 流式 CRC + B-tree | 2304.39 MiB | 1943.39 MiB | `docs/audits/2026-10-21/memory-optimization-2/report.md:9-15` |
| 24 位倒排 + 两遍预分配 | 1903.00 MiB | 1882.89 MiB | `docs/audits/2026-10-21/memory-optimization-3/report.md:17-22` |
| 移除常驻路径 trigram | 1885.88 MiB | 1573.28 MiB | `docs/audits/2026-10-22/remove-path-trigram/report.md:9-13` |
| 目录树 + 名称共享 + 差分编码 | 1573.03 MiB | 1268.56 MiB | `docs/audits/2026-10-22/memory-next/report.md:19-27` |
| 列收窄 + 32 位 hash + 分配器 | 1266.88 MiB | 708.25 MiB | `docs/audits/2026-10-22/allocator-narrow-columns/report.md:23-27` |
| 4B 路径表 + 目录分段 + 去 inode/dev | 702.3 MiB | **573.0 MiB** | `docs/audits/2026-10-22/path-table-dir-runs/report.md:25-31` |

**这七行不能相加，也不能串成一次优化。** 每轮都以上一轮为基线、用同一份只读快照做对照，所以只能读“这一轮省了多少”，不能读“从 3.7 GiB 降到 573 MiB 是同一个版本的两端”。README 只引最后两轮，是诚实的引用方式。

最终轮的结构明细：`pathIndex_` 63.9→34.4、`pathIdxToRecords_` 46.7→8.1、每条固定字段 SoA 135.6→80.1；Phase 2 完成 11.2 s→9.0 s，加载完成（Phase 2 前）473.2→387.9 MiB（`docs/audits/2026-10-22/path-table-dir-runs/report.md:31-38`）。就绪足迹共减少 129.3 MiB（18.4%）。

### 为什么目录池能省这么多

全盘路径的重复不在文件名，而在目录前缀：`/Users/me/Library/Developer/Xcode/DerivedData/...` 下成千上万个文件共享同一串父目录。`DirectoryPool` 把每个目录拆成组件节点，子节点只存 `parent` 和本段字节，`reconstruct` 时才沿父链拼回完整路径（`MacEverything/Core/DirectoryPool.h:9-52`）。代价是查询时多一次父链回溯，所以 `indexForPath` 从 1.06 µs 变成 1.33 µs（`docs/audits/2026-10-22/path-table-dir-runs/report.md:50-51`）。

`matchesSegments` 是这个设计的关键：路径约束查询不需要还原完整路径，而是沿父节点从右向左逐段比较组件（`MacEverything/Core/DirectoryPool.h:128-143`）。只有两种例外会回退到平坦字符串匹配——目录路径超过 `UINT16_MAX`，或该目录有大小写/非法 UTF-8 的整路径覆盖（`lowerOverrides_`）。这个回退分支保证了语义正确，也让“目录池只在常见情况下生效”成为一条可解释的性能边界。

### 为什么名称池能共享

大多数文件名是全小写或大小写不敏感，`FoldedNamePool` 在 `original == lower` 时让两个 view 指向同一段字节，只有真正含大写字母的名字才存两份（`MacEverything/Core/FoldedNamePool.h:5-38`）。这和目录池是同一个思路：先观察数据分布，再为常见情况设计零冗余布局。

### 分配器是这一轮最大的单点

`docs/audits/2026-10-22/allocator-narrow-columns` 的起因值得记住：固定快照上就绪足迹约 1260 MiB，但 malloc 实际在用只有 860.5 MiB；vmmap 显示 Malloc Large (empty) 有 361 MiB 脏页——加载和 Phase 2 期间的大块临时缓冲释放后，被 libmalloc 的 large cache 留在进程内。`malloc_zone_pressure_relief` 在 macOS 27.0.1 上无法归还这部分，只有进程启动时设置 `MallocLargeCache=0` 才能归还（`docs/audits/2026-10-22/allocator-narrow-columns/report.md:5-11`）。

所以 1266.88→708.25 这 44.1% 里，**结构改动只占约 121 MiB，其余来自分配器配置**。这条经验的可迁移性有限：它是 macOS + libmalloc 特有的，换平台或换分配器不会原样复现。daemon 不经 LaunchServices 启动，所以 `main` 里会调 `me::ensureMallocLargeCacheDisabled`，没有设置时写环境变量并 re-exec 一次。

### 一个被移除的索引：路径 trigram

项目曾经同时维护名称 trigram 和路径 trigram。移除路径 trigram 那轮的账很清楚：物理内存 1885.88→1573.28 MiB（−16.6%），加载到 Phase 2 完成 11.87→8.53 s，但代价是宽路径查询从 0.23 ms 涨到 51.14 ms（`MacEverything/a`）、1.01→53.46 ms（`com.apple.Safari/a`）（`docs/audits/2026-10-22/remove-path-trigram/report.md:9-31`）。

这是一次非常典型的取舍：**用 300 MiB 常驻内存换宽路径查询的 50 ms**。项目选择了内存，因为常驻是产品前提，而宽路径查询只在“目录名 + 短词”这种组合下才慢。后来的 win-inspired 轮把 `MacEverything/a` 从 112.59 拉回 40.34 ms，靠的是目录候选展开 + 名称命中后不拼路径，而不是把路径 trigram 加回来（`docs/audits/2026-10-22/win-inspired/report.md:34-42`）。

### 前缀删除：从 2.9 秒到 51 毫秒

`removeByPathPrefix` 原来遍历路径表每条记录、逐条拼完整路径再比前缀，全程持写锁；638 万条记录上哪怕前缀下只有几条，也要近 3 秒。改法是把“记录前缀匹配”转成“目录前缀匹配”：先按长度跳过不可能匹配的目录，再还原其余目录的小写路径比较，命中目录的记录从 `pathIdxToRecords_` 取出，最后单独查一次“路径恰好等于前缀”的那条记录（`docs/audits/2026-10-22/prefix-remove-dirs/report.md:8-24`）。

结果：小目录 28 条 2914.5→51.6 ms，`/System/Library/Frameworks` 41,562 条 4275.9→1408.5 ms（`docs/audits/2026-10-22/prefix-remove-dirs/report.md:26-32`）。剩下那 1.36 s 花在逐条维护 trigram 倒排上，之后又被批量 `eraseSorted` 优化到 245.7/252.8 ms（`docs/audits/2026-10-22/batch-index-removal/report.md`）。**同一件事被拆成两次优化：先减少“找谁要删”，再减少“删的时候维护索引”。**

## 代码证据

| 结论 | 证据 |
|---|---|
| FSEvents 0.3s 合并、eventId 续传 | `MacEverything/Core/FileSystemWatcher.cpp:52-63` |
| journal 截断检测与排除目录 | `MacEverything/Core/FileSystemWatcher.cpp:177-192` |
| 事件翻译为 REMOVE_TREE/rescanDirs | `MacEverything/Core/ServiceEngine+FSEvents.cpp:44-123` |
| 整批一次加锁 | `MacEverything/Core/ServiceEngine+FSEvents.cpp:129-147` |
| 5s debounce + 300s 节流 | `MacEverything/Core/ServiceEngine+FSEvents.cpp:225-315`、`MacEverything/Core/ServiceEngine.h:173-174` |
| 目录池共享前缀 + 原位段匹配 | `MacEverything/Core/DirectoryPool.h:9-52`、`:128-143` |
| 名称大小写共享字节 | `MacEverything/Core/FoldedNamePool.h:5-38` |
| 窄列 + 溢出旁表 | `MacEverything/Core/NarrowColumn.h:15-56` |
| 4B 槽路径表 | `MacEverything/Core/PathRecordTable.h:12-111` |
| 目录→记录 CSR 分段 | `MacEverything/Core/DirRecordMap.h:13-96` |

## 复杂度/性能边界

| 操作 | 复杂度 | 边界 |
|---|---|---|
| 单批 FSEvents 翻译 | O(events) | 需先持有引擎引用；`REMOVE_TREE` 可能很大 |
| `batchMutate` | O(mutations × trigram 维护) | 整批一次写锁，期间搜索等待 |
| 目录重扫 | O(该目录下记录) | 5s debounce、300s 节流 |
| 路径查找 | 平均 O(1)，最坏 O(n) 线性探测 | 85% 负载后扩容 1.5× |
| 前缀删除 | O(目录数) + O(命中记录 × trigram 维护) | Phase 2 未完成时退回全量扫描 |
| 内存 | 约 94 B/有效记录（573.0 MiB / 638 万） | 不含内容索引、GUI、临时缓冲 |

## 取舍与局限

- **内存数字都来自同一台机器、同一份快照**：换磁盘、换 macOS 版本、换文件分布都可能变；`MallocLargeCache=0` 的收益尤其不可移植。
- **短时观察**：GUI 只观察了约 3.5 分钟（Phase 2 完成 600 MB，3.5 分钟后 612 MB），没做长期驻留、保存/压缩峰值测试（`docs/audits/2026-10-22/path-table-dir-runs/report.md:79-92`）。项目自己在 README 里也写明“不保证长期运行、保存、压缩或启用全文索引后始终低于 1 GiB”。
- **仍未达到 1 GiB**：win-inspired 轮之后，实时桌面进程 vmmap 物理足迹约 1.2 GiB、启动历史峰值约 1.6 GiB（`docs/audits/2026-10-22/win-inspired/report.md:60`）。
- **文件名含 `/` 查不到**：路径表用“目录规范号 + 小写文件名”作键，文件名里出现 `/` 会破坏语义；正常文件系统不会产生这种名字（`docs/audits/2026-10-22/path-table-dir-runs/report.md:93`）。
- **窄列旁表是稀疏结构**：超过 4 GiB 的文件写旁表（实测 75 个），修改时间 0 条溢出；旁表查询比主列慢，只是这类文件很少（`docs/audits/2026-10-22/allocator-narrow-columns/report.md:41-43`）。
- **目录池有两条回退路径**：超长路径和 `lowerOverrides_` 都退回平坦匹配，意味着这两类目录的查询成本与普通目录不同。
- **内存优化不等于查询更快**：多轮报告都写明查询差异在噪声内，`indexForPath` 甚至变慢（1.06→1.33 µs）。目录树 + 差分倒排那一轮是最直白的证据：就绪足迹 1573.03→1268.56 MiB，但 `readme` 从 2.057 ms 涨到 6.290 ms、`MacEverything/a` 从 56.127 涨到 123.386 ms，保存耗时 0.145→0.922 s（`docs/audits/2026-10-22/memory-next/report.md:36-46`）。把“省内存”当“提性能”宣传是误读。

## 我能偷什么

1. **事件先翻译成“变更计划”**：把平台事件（FSEvents/usn/inotify）与索引更新解耦，核心只认 `Add/Remove/Update/RemoveTree`。
2. **目录级延迟重扫**：目录内文件成批变化时，与其逐条处理，不如 5 秒后重扫一次；用 debounce + 节流控制最坏成本。
3. **共享前缀池**：任何“大量长字符串共享前缀”的场景（路径、URL、模块名）都值得建组件树，而不是存完整字符串。
4. **窄列 + 旁表**：主流程用 32 位，少数溢出值走旁表；这是“99% 快路径 + 1% 精确路径”的经典组合。
5. **先减少工作量，再减少单次工作量**：前缀删除先优化“找谁要删”（目录树），再优化“删的时候维护索引”（批量 eraseSorted）。两次都比“整体重写删除逻辑”小得多。
6. **把内存测量拆成“结构”和“分配器”两部分**：否则你会在代码里找那 360 MiB，而它其实在 libmalloc 的 free list 里。

**一句话记住：** FSEvents 保证索引只处理“变化”，池化/窄列/差分编码保证“变化之外的部分”不占内存；两者一起才让常驻全盘索引成为可能，而任何一块退化都会直接反映在续航或内存上。
