# 04 深挖一：索引与 WAL 持久化

> 这篇回答：600 万条记录怎么在崩溃后不丢、启动时又快得起来。

## 问题

全盘索引有三个互相拉扯的目标：

1. **启动快**：用户按下快捷键时，不能等 600 万条记录逐条反序列化。
2. **不丢数据**：FSEvents 已经处理过的变更，进程崩溃后不能回到旧状态。
3. **写入不阻塞搜索**：保存时不能把读锁按住几百毫秒。

`SearchEngine` 的索引是列式 SoA：`types_`、`sizes_`、`modTimes_`、`pathIndices_` 加上名称池、目录池、路径表（`MacEverything/Core/SearchEngine.h:112-160`）。这套结构如果按对象逐条写盘，格式和内存布局会长期分叉。

## 朴素做法为什么不够

| 做法 | 问题 |
|---|---|
| 每条记录一个小文件 | 600 万文件，元数据开销和 inode 压力爆炸 |
| 每次变更全量重写 | 每删一个文件写 700 MiB，SSD 寿命和延迟都受不了 |
| 纯 WAL、永不重写 | 日志无限增长，启动回放越来越慢 |
| 纯内存映射文件 | 删除/压缩会留下洞，格式演进困难；崩溃一致性靠 OS |
| SQLite 单表 | 多一个依赖，且列布局、trigram 倒排仍要自己维护 |

## 这个项目怎么做

**磁盘格式：一个 v6 文件，11 个 section。**

`FlatIndexWriter::fullRewrite` 写临时文件：64 字节 Header（magic `MEV6`、版本、记录数、live 数、时间戳、lastEventId、section 数、header CRC），随后是 24 字节的 SectionEntry 表，再依次写 `NAMES_ORIG`、`NAMES_LOWER`、`PATH_POOL`、`LOWER_PATH_POOL`、`PATH_INDICES`、`TYPES`、`SIZES`、`MOD_TIMES`、`INODES`、`DEV_IDS`、`METADATA_KV`（`MacEverything/Core/FlatIndexWriter.cpp:228-407`）。数据列写完后先释放读锁，再写 metadata、fsync、rename（`:354-402`）。加载时校验 magic、version、header CRC、文件边界和 section 越界（`:413-467`）。

**增量：WAL 记录 op + 路径 + 记录。**

`WALEntry` 只有 `Add/Remove/Update` 三种操作；`append` 把 `op + pathLen + path + record` 序列化后 `fwrite`，每条 `fflush`，每 64 条 `fsync`（`MacEverything/Core/IndexWAL.cpp:127-185`）。WAL 上限 50 MB，超了置 `overflowed_` 并返回 false（`:132-137`）。读取时校验 `WAL1` magic/version，逐条 CRC32；遇到坏条目记录 `"CRC mismatch at offset ... recovered N entries"` 并停止，保留之前可恢复的记录（`:187-252`）。

**刷盘策略：不是“每次变更都重写”。**

`IndexPersistence::flush` 先看 WAL 是否为空/不脏/条目 <100，是就跳过；如果 tombstone 占比 >25%，直接 `fullCompact`；否则“新建 WAL → 原子换 WAL → fullRewrite v6 → rename 新 WAL”（`MacEverything/Core/IndexPersistence.cpp:114-200`）。`decideAutoFlush` 的阈值是：WAL 溢出或 ≥32 MB 立即重写；距上次重写 <15 min 不重写；≥8 MB 强制；≥2 h 且条目 ≥100 普通重写（`:263-271`）。

**启动：先装列，再补索引。**

`loadRecordsV6` 不做逐条对象化，直接把读出的池和列装进 `SearchEngine`，只重建 `pathIndex_` / `pathIdxToRecords_`，并置 `phase2Pending_ = true`（`MacEverything/Core/SearchEngineV6.cpp:11-58`）。`completePhase2` 只快照 `types_`、`modTimes_`、名称池（约 5 MB，而不是 440 MB），在锁外构建 trigram/extension/recent，再持锁 swap，并回放构建期间累积的变更（`:60-126`）。

**压缩：重编号 + 重写。**

`fullCompact` 调 `compactRecords` 重编号，`contentIndex` 重新映射，再 `fullRewrite`（`MacEverything/Core/IndexPersistence.cpp:202-261`）。v6 加载兼容 `index.v6 → pages → index.bin` 三代格式（`MacEverything/Core/IndexPersistence.cpp:30-92`）。

**为什么不是 mmap？** mmap 看起来能省一次拷贝，但删除/压缩会在文件里留下洞，section 长度变化又要重新映射；更麻烦的是崩溃时无法保证 header 与数据同步。当前方案把“读”做成一次性顺序读，把“写”做成完整的 tmp 文件 + rename，牺牲一点启动拷贝，换来格式简单和恢复路径短。

**写入顺序的细节**：`fullRewrite` 先写数据 section，再写 section 表与 header；header 的 CRC 覆盖前 36 字节，加载时先验证 header 再验证每个 section 的边界（`MacEverything/Core/FlatIndexWriter.cpp:376-390,413-467`）。WAL 轮换时先创建新 WAL、原子替换旧 WAL，再 full rewrite，最后 rename 新 WAL——任何一步崩溃，至少有一份可读的旧文件或新文件（`MacEverything/Core/IndexPersistence.cpp:114-200`）。

**为什么 WAL 存路径而不是记录号？** 因为压缩会重编号，昨天的记录 42 今天可能变成记录 17；路径是跨版本稳定的身份。代价是路径字符串重复写入，WAL 比二进制记录号大，但 50 MB 上限和压缩策略把这个问题限制住了。回放时按路径重新查找/插入，也顺便修正了压缩导致的编号漂移。

**兼容策略是“读旧、写新”**：加载时按 `index.v6 → pages → index.bin` 依次尝试，旧格式读进来后在下一次刷盘时写成 v6；写入端只产出 v6。这样用户升级后不需要手动清缓存，回滚旧版本也还能读 v6（旧读取器会跳过不认识的 section）。代价是加载代码要同时维护三代解析器，测试也要覆盖 v5/v3 迁移；每加一个 section，迁移测试矩阵都会变大，所以格式演进要克制，能用 metadata 键值对解决的就不要加列。

## 代码证据

| 结论 | 证据 |
|---|---|
| v6 是 11 段扁平文件，不是逐条记录 | `MacEverything/Core/FlatIndexWriter.cpp:228-407` |
| 写数据列时释放读锁，fsync/rename 不阻塞搜索 | `MacEverything/Core/FlatIndexWriter.cpp:354-356,392-402` |
| WAL 每条 flush、每 64 条 fsync | `MacEverything/Core/IndexWAL.cpp:127-185` |
| WAL 50 MB 上限 + CRC 恢复 | `MacEverything/Core/IndexWAL.cpp:132-137,187-252` |
| tombstone >25% 触发全量压缩 | `MacEverything/Core/IndexPersistence.cpp:145-157` |
| 自动刷盘有 15 min–2 h 的节流窗口 | `MacEverything/Core/IndexPersistence.cpp:263-271` |
| Phase 2 只快照少量列，锁外建索引 | `MacEverything/Core/SearchEngineV6.cpp:60-126` |

## 复杂度/性能边界

| 操作 | 复杂度/成本 | 实测/边界 |
|---|---|---|
| v6 全量写 | O(records + bytes)，约 712 MiB I/O | 固定快照保存 120.2 ms（`docs/audits/2026-10-21/memory-optimization-2/report.md:13`） |
| WAL 追加 | O(单条记录)，顺序写 | 每 64 条一次 fsync；50 MB 上限 |
| 启动加载 | O(文件大小) + Phase 2 O(records) | 加载到 Phase 2 9.0 s（`docs/audits/2026-10-22/path-table-dir-runs/report.md:31`） |
| 全量压缩 | O(records) 重编号 + O(bytes) 重写 | tombstone >25% 或 WAL 超限才触发 |
| 崩溃恢复 | O(WAL 条目) | 坏条目截断，保留之前记录 |

## 取舍与局限

- **写放大没消失**：每次 full rewrite 仍写约 712 MiB；项目自己在审计里明确“未解决”（`docs/audits/2026-10-21/memory-optimization-2/report.md:61`）。这是简单格式的代价。
- **WAL 不是事务日志**：没有事务边界，也没有回滚；它只保证“已 append 的单条操作可重放”。
- **50 MB 上限是硬阈值**：超过后 `append` 返回 false，必须走全量刷盘；高频写入会更快触发重写。
- **保存期间更新会短暂排队**：最大约 151 ms（`docs/audits/2026-10-21/memory-optimization-2/report.md:15,60`），不是零影响。
- **inode/devId 仍保留 section 但填 0**：搜索/API 不读它们，属于为兼容旧读取器保留的空间（`docs/audits/2026-10-22/path-table-dir-runs/report.md:17-21`）。

## 我能偷什么

1. **列式文件 + section 表**：格式演进时加 section 比改全局版本容易；每个 section 独立 CRC，坏一块不影响其他块。
2. **WAL 轮换 + 全量重写**：不要做“原地更新大文件”，换成“新文件 + rename”，崩溃时旧文件仍完整。
3. **先装列、后建索引**：把启动拆成“可搜”和“快搜”两阶段，用户感知最好。
4. **用 tombstone 比例决定压缩**，而不是按时间盲目重写；删除密集时才值得付全量成本。

**一句话记住：** v6 把索引变成“可整体替换的列式快照”，WAL 只负责两次快照之间的增量，两者用“新文件 + rename”拼出崩溃一致性。
