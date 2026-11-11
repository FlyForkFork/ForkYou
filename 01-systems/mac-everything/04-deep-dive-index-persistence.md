# 04 深挖一：索引与 WAL 持久化

> 这篇回答什么问题：600 万条记录怎么在崩溃后不丢、启动时又快得起来，以及 1.4.0 补上的“压缩重叠”事故到底是怎么发生的。

## 问题

全盘索引有三个互相拉扯的目标：

1. **启动快**：用户按下快捷键时，不能等 600 万条记录逐条反序列化。
2. **不丢数据**：FSEvents 已经处理过的变更，进程崩溃后不能回到旧状态。
3. **写入不阻塞搜索**：保存时不能把读锁按住几百毫秒。

`SearchEngine` 的索引是列式 SoA：`types_`、`sizes_`、`modTimes_`、`pathIndices_`，加上名称池、目录池、路径表（`MacEverything/Core/SearchEngine.h:263-565`）。这套结构如果按对象逐条写盘，格式和内存布局会长期分叉。

## 朴素做法为什么不够

| 做法 | 问题 |
|---|---|
| 每条记录一个小文件 | 600 万文件，元数据开销和 inode 压力爆炸 |
| 每次变更全量重写 | 每删一个文件写 700 MiB，SSD 寿命和延迟都受不了 |
| 纯 WAL、永不重写 | 日志无限增长，启动回放越来越慢 |
| 纯内存映射文件 | 删除/压缩会留下洞，格式演进困难；崩溃一致性靠 OS |
| SQLite 单表 | 多一个依赖，且列布局、trigram 倒排仍要自己维护 |

## 这个项目怎么做

### 磁盘格式：一个 v6 文件，11 个 section

`FlatIndexWriter::fullRewrite` 写临时文件：64 字节 Header（magic `MEV6`、版本、记录数、live 数、时间戳、lastEventId、section 数、header CRC），随后是 SectionEntry 表，再依次写 `NAMES_ORIG`、`NAMES_LOWER`、`PATH_POOL`、`LOWER_PATH_POOL`、`PATH_INDICES`、`TYPES`、`SIZES`、`MOD_TIMES`、`INODES`、`DEV_IDS`、`METADATA_KV`（`MacEverything/Core/FlatIndexWriter.h:35-51`、`MacEverything/Core/FlatIndexWriter.cpp:228-407`）。数据列写完后先释放读锁，再写 metadata、fsync、rename（`MacEverything/Core/FlatIndexWriter.cpp:354-356`、`:392-402`）。加载时校验 magic、version、header CRC、文件边界和 section 越界（`MacEverything/Core/FlatIndexWriter.cpp:413-613`）。

一个容易被忽略的细节：`INODES`、`DEV_IDS` 两个 section 仍在文件里，但写的时候填 0、加载时直接跳过（`MacEverything/Core/FlatIndexWriter.cpp:575`）。搜索、界面、API 都不读它们，保留只为让旧读取器照常工作——这是“格式兼容优先于空间”的一次明确取舍。

### 增量：WAL 记录 op + 路径 + 记录

`WALEntry` 只有 `Add/Remove/Update` 三种操作；`append` 把 `op + pathLen + path + record` 序列化后 `fwrite`，每条 `fflush`，每 `syncInterval_` 条 `fsync`（`MacEverything/Core/IndexWAL.cpp:127-185`）。WAL 上限 50 MB，超了置 `overflowed_` 并返回 false（`MacEverything/Core/IndexWAL.h:74`）。读取时校验 `WAL1` magic/version，逐条 CRC32；遇到坏条目记录 `"CRC mismatch at offset ... recovered N entries"` 并停止，保留之前可恢复的记录（`MacEverything/Core/IndexWAL.cpp:187-252`）。CRC 在 ARM 上走硬件指令（作者注释称约 15 GB/s，软件 slicing-by-4 约 2 GB/s，`MacEverything/Core/IndexWAL.cpp:7-10`）。

**为什么 WAL 存路径而不是记录号？** 因为压缩会重编号，昨天的记录 42 今天可能变成记录 17；路径是跨版本稳定的身份。代价是路径字符串重复写入，WAL 比二进制记录号大，但 50 MB 上限和压缩策略把这个问题限制住了。回放时按路径重新查找/插入，也顺便修正了压缩导致的编号漂移。

### 刷盘策略：不是“每次变更都重写”

`IndexPersistence::flush` 先看 WAL 是否为空/不脏/条目 <100，是就跳过；如果 tombstone 占比 >25%，直接 `fullCompact`；否则“新建 WAL → 原子换 WAL → fullRewrite v6 → rename 新 WAL”（`MacEverything/Core/IndexPersistence.cpp:114-200`）。`decideAutoFlush` 的阈值是：WAL 溢出或 ≥32 MB 立即重写；距上次重写 <15 min 不重写；≥8 MB 强制；≥2 h 且条目 ≥100 普通重写（`MacEverything/Core/IndexPersistence.cpp:263-271`、常量在 `MacEverything/Core/IndexPersistence.h:67-85`）。

这套阈值的设计意图很清楚：全量重写是几百 MB 的 I/O，不能按固定节拍做；用“WAL 攒了多少未落盘的变更”驱动，才能让写放大与真实变更量成正比。

### 启动：先装列，再补索引

`loadRecordsV6` 不做逐条对象化，直接把读出的池和列装进 `SearchEngine`，只重建 `pathIndex_` / `pathIdxToRecords_`，并置 `phase2Pending_ = true`（`MacEverything/Core/SearchEngineV6.cpp:11-58`）。`completePhase2` 只快照 `types_`、`modTimes_`、名称池的小写视图，在锁外构建 trigram/extension/recent，再持锁 swap，并回放构建期间累积的变更（`MacEverything/Core/SearchEngineV6.cpp:60-126`）。读侧通过 `readViewForV6` 借用列，靠 `mutationGate_` + 共享锁保证借用期间数据不被换掉（`MacEverything/Core/SearchEngineV6.cpp:128-131`）。

### 压缩：重编号 + 重写，而且必须单飞

`fullCompact` 调 `compactRecords` 重编号，`contentIndex` 重新映射，再 `fullRewrite`（`MacEverything/Core/IndexPersistence.cpp:202-261`）。`compactRecords` 是 COW 三阶段：Phase 1 拿共享锁快照列；Phase 2 在锁外构建紧凑数据与新索引；Phase 3 拿唯一锁校验代际、换入、回放期间的增删（`MacEverything/Core/SearchEngine.cpp:590-810`）。

**1.4.0 的事故值得单独讲。** 定时落盘（`IndexPersistence::fullCompact`）和目录重扫后的检查（`ServiceEngine::rescanSubtree`）可以同时进入压缩。第一次压缩换入重新编号的数据后，第二次拿着旧快照逐条比对，全部失配，把快照里的路径都当成“压缩期间被删除”并标记墓碑，日志为 `replayed 0 adds, 6472797 deletes`，存活记录从约 650 万降到 24,741 条，并且这个损坏状态被写进 `index.v6`，重启后依然保持（`docs/changelog/153-overlapping-compaction-index-loss.md:7-11`）。

修复是两条，缺一不可：

1. `compactRecords` 增加专用互斥锁并用 `try_to_lock` 获取，已有压缩在跑时后到者直接返回空映射，不等待也不占第二份快照内存（`MacEverything/Core/SearchEngine.cpp:594-595`）。
2. Phase 3 换入前校验 `compactionGen_`，如果第二阶段期间 `loadRecords` 等操作整体重载过记录，就放弃本次压缩，避免用旧快照覆盖新数据（`MacEverything/Core/SearchEngine.cpp:715-718`、`MacEverything/Core/SearchEngine.h:552-553`）。

只加互斥锁不够——`docs/changelog/153` 明确记录“只加互斥锁时重新加载场景仍失败”，两项修复都加上才通过。这个细节很能说明问题：**并发 bug 往往不是一把锁能解决的，锁保护的是“同时进入”，代际校验保护的是“进入后世界变了”。**

### 兼容策略是“读旧、写新”

加载时按 `index.v6 → pages → index.bin` 依次尝试，旧格式读进来后在下一次刷盘时写成 v6；写入端只产出 v6（`MacEverything/Core/IndexPersistence.cpp:30-92`）。这样用户升级后不需要手动清缓存；但加载代码只保证“新读旧”，不保证“旧读新”：回滚时要看旧版本是否认识 v6，不认识就只能在旧格式上重建。代价是加载代码要同时维护三代解析器，测试也要覆盖 v5/v3 迁移；每加一个 section，迁移测试矩阵都会变大。

### 一个 main 上还没修好的口子：重建索引

main 上有两条“重建”路径，**两条都不真正重建 v6**：

1. **GUI 菜单**：`SearchViewModel.rebuildIndex` 删的是 `index.bin`、`index.wal`、`index.pages`、`index.ptable` 四个文件（`MacEverything/App/SearchViewModel.swift:214-218`），**没有删 `index.v6`**。而 `IndexPersistence::load` 第一优先就是 v6（`MacEverything/Core/IndexPersistence.cpp:33-44`），所以删完再 `startIncremental()`，v6 又原样被加载回来，用户看到的是“重建了但还是那些结果”。
2. **HTTP 接口**：`POST /api/index/rebuild` 只调用 `adminCallbacks_.onRebuildIndex`（`MacEverything/Core/HttpServer.cpp:585-590`），而 main 上这个回调最终只是 `postNotificationName:@"rebuildIndex"`（`MacEverything/Bridge/MacSearchBridge.mm:231-234`），全仓没有监听者。

未合并的 `fix/rebuild-index-v6` 分支（`8ebc85f`）把两条路径都补成真正的重建：新增 `ServiceEngine::rebuildIndex`，用 `compare_exchange` 在扫描/同步中拒绝请求，`dispatch_sync` 排空 `mutationQueue_`，先停旧 persistence 再删文件（否则它的定时器会把正在丢弃的记录又写回 `index.v6`），删除列表包含 `index.v6`、`index.v6.tmp`、`index.wal`、`index.wal.new`、`index.bin`、`index.pages`、`index.ptable`、`content_index.bin`、`content_index.wal`，最后 `startIncremental` 全扫（`origin/fix/rebuild-index-v6:MacEverything/Core/ServiceEngine.cpp:406-440`）。

这个缺口和 1.4.0 的事故直接相连：`docs/changelog/153-overlapping-compaction-index-loss.md` 写“已损坏的本地索引不会自动恢复，升级后需要执行一次 Rebuild Index”——而在 main 上，这次 Rebuild 并不会丢掉那个损坏的 v6。

## 代码证据

| 结论 | 证据 |
|---|---|
| v6 是 11 段扁平文件，不是逐条记录 | `MacEverything/Core/FlatIndexWriter.h:35-51`、`MacEverything/Core/FlatIndexWriter.cpp:228-407` |
| 写数据列时释放读锁，fsync/rename 不阻塞搜索 | `MacEverything/Core/FlatIndexWriter.cpp:354-356`、`:392-402` |
| WAL 每条 flush、每 `syncInterval_` 条 fsync | `MacEverything/Core/IndexWAL.cpp:127-185` |
| WAL 50 MB 上限 + CRC 恢复 | `MacEverything/Core/IndexWAL.h:74`、`MacEverything/Core/IndexWAL.cpp:187-252` |
| tombstone >25% 触发全量压缩 | `MacEverything/Core/IndexPersistence.cpp:145-157` |
| 自动刷盘有 15 min–2 h 的节流窗口 | `MacEverything/Core/IndexPersistence.cpp:263-271` |
| Phase 2 只快照少量列，锁外建索引 | `MacEverything/Core/SearchEngineV6.cpp:60-126` |
| 压缩单飞 + 代际校验 | `MacEverything/Core/SearchEngine.cpp:594-595`、`:715-718` |

## 复杂度/性能边界

| 操作 | 复杂度/成本 | 实测/边界 |
|---|---|---|
| v6 全量写 | O(records + bytes)，约 712 MiB I/O | 固定快照保存 120.2 ms（`docs/audits/2026-10-21/memory-optimization-2/report.md:13-15`） |
| WAL 追加 | O(单条记录)，顺序写 | 每条 flush；50 MB 上限 |
| 启动加载 | O(文件大小) + Phase 2 O(records) | 加载 2.43 s，Phase 2 完成 9.0 s（`docs/audits/2026-10-22/path-table-dir-runs/report.md:29-31`） |
| 全量压缩 | O(records) 重编号 + O(bytes) 重写 | tombstone >25% 或 WAL 超限才触发 |
| 崩溃恢复 | O(WAL 条目) | 坏条目截断，保留之前记录 |

## 取舍与局限

- **写放大没消失**：每次 full rewrite 仍写约 712 MiB；项目自己在审计里明确“未解决”（`docs/audits/2026-10-21/memory-optimization-2/report.md:61`）。这是简单格式的代价。
- **WAL 不是事务日志**：没有事务边界，也没有回滚；它只保证“已 append 的单条操作可重放”。
- **50 MB 上限是硬阈值**：超过后 `append` 返回 false，必须走全量刷盘；高频写入会更快触发重写。
- **保存期间更新会短暂排队**：同一轮对照里最长约 151 ms（`docs/audits/2026-10-21/memory-optimization-2/report.md:15`），不是零影响。另一份共享存储实验里保存从 0.145 s 涨到 0.922 s、单次更新最长等待从 177 ms 涨到 942 ms，说明“锁外保存”并非在所有磁盘上都更快。
- **inode/devId 仍占 section 但填 0**：为兼容旧读取器保留的空间，属于格式债（`docs/audits/2026-10-22/path-table-dir-runs/report.md:17-21`）。
- **并发压缩后到者直接放弃**：`try_to_lock` 换来了安全，但也意味着密集重扫时压缩可能长时间“压不上”，tombstone 会持续累积，只能等下一次机会。
- **WAL 满时的静默缺口**：`IndexWAL::append` 到 50 MB 后返回 false，但 `SearchEngine` 的六处调用点都不检查返回值（`MacEverything/Core/SearchEngine.cpp:380`、`:423`、`:458`、`:489`、`:506`、`:533`）。内存变更照常生效，下一次 fullRewrite 会把它补进 v6；如果重写前崩溃，这段变更丢失，Remove 可能“复活”、Update 回旧值。这是有意的性能取舍，也是运维上必须留足磁盘空间的原因。
- **全量重写要预留双份空间**：写的是 `index.v6.tmp`，fsync 后才 rename 覆盖旧文件；重建/升级期间旧 v6 与 tmp 同时存在，磁盘要按约 2 倍索引大小预留。`F_NOCACHE` 只是绕过 page cache，不减少写入量。

## 我能偷什么

1. **列式文件 + section 表**：格式演进时加 section 比改全局版本容易；每个 section 独立 CRC，坏一块不影响其他块。
2. **WAL 轮换 + 全量重写**：不要做“原地更新大文件”，换成“新文件 + rename”，崩溃时旧文件仍完整。
3. **先装列、后建索引**：把启动拆成“可搜”和“快搜”两阶段，用户感知最好。
4. **用 tombstone 比例决定压缩**，而不是按时间盲目重写；删除密集时才值得付全量成本。
5. **重活必须同时有“互斥”和“代际校验”**：互斥防同时进入，代际防进入后数据被整体替换。这是本项目用一次真实数据丢失换来的教训。

**一句话记住：** v6 把索引变成“可整体替换的列式快照”，WAL 只负责两次快照之间的增量，两者用“新文件 + rename”拼出崩溃一致性；而真正让这份一致性站得住脚的，是压缩路径上那把 `try_to_lock` 和换入前的代际校验。
