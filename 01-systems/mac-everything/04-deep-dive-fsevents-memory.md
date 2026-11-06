# 04 深挖三：FSEvents 增量索引与内存优化

> 这篇回答：索引怎样跟上文件系统变化，又怎样把 638 万条记录压到 573 MiB。

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

`FileSystemWatcher` 用 `FSEventStreamCreate` 订阅文件事件：`sinceEventId` 从上次位置开始，0.3 秒合并窗口，flags 含 `FileEvents | NoDefer | UseCFTypes | IgnoreSelf`（`MacEverything/Core/FileSystemWatcher.cpp:52-63`）。流被截断（journal 丢失）时置 `journalTruncated`，上层退回全盘重扫（`:176-192`）。

`ServiceEngine::collectFSEventMutations` 把一批事件翻译成三类输出（`MacEverything/Core/ServiceEngine+FSEvents.cpp:44-123`）：

- `MustScanSubDirs` → `rescanDirs`（`:56-59`）；
- 删除/移走目录 → `REMOVE_TREE` 整树删除（`:68-85`）；
- rename 进来的目录 → `rescanDirs`（`:99-101`）；
- 同一批里已被 `REMOVE_TREE` 覆盖的子路径，后续 op 直接丢掉，避免重复（`:104-121`）。

`applyFSEvents` 先处理内容索引更新，再调 `engine->batchMutate`，整批只加一次锁（`:129-147`）。目录级重扫不立即执行，而是 `scheduleRescanForPaths` 做 5 秒 debounce + 300 秒节流（`:225-315`）；重扫只替换目录内容，保留目录自身记录（`:317-334`）；tombstone 超过 30% 时顺手 `compactRecords`（`:336-364`）。

### 内存：五层压缩

| 层 | 做法 | 收益 |
|---|---|---|
| 目录池 | 目录按组件建树，子目录共享父前缀；路径按需 `reconstruct` | 去掉重复路径前缀（`MacEverything/Core/DirectoryPool.h:20-93`） |
| 名称池 | 原始名与小写名共享同一段字节（当二者相同时） | 常见全小写文件名省一半（`MacEverything/Core/FoldedNamePool.h:15-27`） |
| 倒排表 | varint 差分 + 每 128 条一个稀疏 checkpoint | posting 从定长 4B 降到约 1–2B（`MacEverything/Core/PackedPostingList.h`） |
| 窄列 | `sizes_`/`modTimes_` 用 32 位，溢出值进 `absl::btree_map` 旁表 | 两列各 49.3→24.6 MiB（`MacEverything/Core/NarrowColumn.h:14-36`） |
| 路径表 | 开放寻址，每槽只存 4B 记录号；键由记录自身算出 | `pathIndex_` 63.9→34.4 MiB（`MacEverything/Core/PathRecordTable.h:22-93`） |

`DirRecordMap` 进一步把“每个目录一个小 vector”改成 CSR 连续段 + 追加尾列表，`pathIdxToRecords_` 从 46.7 MiB 降到 8.1 MiB（`docs/audits/2026-10-22/path-table-dir-runs/report.md:35-37`）。

### 内存账本（同一份固定快照）

| 指标 | 优化前 | 优化后 |
|---|---:|---:|
| 就绪物理足迹 | 1266.88 MiB | 708.25 MiB（列收窄+分配器） |
| 就绪物理足迹（继续做路径表） | 702.3 MiB | **573.0 MiB** |
| `pathIndex_` | 63.9 MiB | 34.4 MiB |
| `pathIdxToRecords_` | 46.7 MiB | 8.1 MiB |
| 固定字段 SoA | 135.6 MiB | 80.1 MiB |
| 加载到 Phase 2 | 11.2 s | 9.0 s |

数据来自 `docs/audits/2026-10-22/allocator-narrow-columns/report.md:23-37` 与 `docs/audits/2026-10-22/path-table-dir-runs/report.md:27-37`。两轮是独立实验，不能把 1266→573 当成一次连续优化。

**为什么目录池能省这么多？** 因为全盘路径的重复不在文件名，而在目录前缀：`/Users/me/Library/Developer/Xcode/DerivedData/...` 下成千上万个文件共享同一串父目录。`DirectoryPool` 把每个目录拆成组件节点，子节点只存 `parent` 和本段字节，`reconstruct` 时才沿父链拼回完整路径（`MacEverything/Core/DirectoryPool.h:20-93`）。代价是查询时多一次父链回溯，所以路径还原比直接读字符串慢——审计里 `indexForPath` 从 1.06 µs 变成 1.33 µs 就是这个代价（`docs/audits/2026-10-22/path-table-dir-runs/report.md:50-51`）。

**为什么名称池能共享？** 大多数文件名是全小写或大小写不敏感，`FoldedNamePool` 在 `original == lower` 时让两个 view 指向同一段字节，只有真正含大写字母的名字才存两份（`MacEverything/Core/FoldedNamePool.h:15-27`）。这和目录池是同一个思路：先观察数据分布，再为常见情况设计零冗余布局。

**为什么要用固定快照做对照？** 实时 GUI 的索引会随文件增删变化，直接比较两个时间点的 footprint 没有意义。审计把同一份 `/tmp/maceverything-memory-2/index.v6` 只读挂载给两个构建，记录数、路径数、目录数完全一致，才能把差异归因到代码而不是数据。代价是它不能代表长期驻留后的碎片与缓存行为，所以报告同时给了 GUI 的短时观察，但明确不把两组数字相减。

## 代码证据

| 结论 | 证据 |
|---|---|
| FSEvents 0.3s 合并、eventId 续传 | `MacEverything/Core/FileSystemWatcher.cpp:52-63,122-125` |
| 事件翻译为 REMOVE_TREE/rescanDirs | `MacEverything/Core/ServiceEngine+FSEvents.cpp:44-123` |
| 整批一次加锁 | `MacEverything/Core/ServiceEngine+FSEvents.cpp:129-147` |
| 5s debounce + 300s 节流 | `MacEverything/Core/ServiceEngine+FSEvents.cpp:225-315` |
| 目录池共享前缀 | `MacEverything/Core/DirectoryPool.h:20-93` |
| 名称大小写共享字节 | `MacEverything/Core/FoldedNamePool.h:15-27` |
| 窄列 + 溢出旁表 | `MacEverything/Core/NarrowColumn.h:14-36,62-64` |
| 4B 槽路径表 | `MacEverything/Core/PathRecordTable.h:22-93` |

## 复杂度/性能边界

| 操作 | 复杂度 | 边界 |
|---|---|---|
| 单批 FSEvents 翻译 | O(events) | 需先持有引擎引用；`REMOVE_TREE` 可能很大 |
| `batchMutate` | O(mutations × trigram 维护) | 整批一次写锁，期间搜索等待 |
| 目录重扫 | O(该目录下记录) | 5s debounce、300s 节流 |
| 路径查找 | 平均 O(1)，最坏 O(n) 线性探测 | 85% 负载后扩容 1.5× |
| 内存 | 约 90 B/有效记录（573 MiB / 638 万） | 不含内容索引、GUI、临时缓冲 |

## 取舍与局限

- **前缀删除仍会持写锁约 5 秒**：41,590 条 `removeByPathPrefix` 实测 5709→4719 ms，项目明确说这是“原本就存在、本轮没处理”的问题（`docs/audits/2026-10-22/path-table-dir-runs/report.md:53-55`）。
- **文件名含 `/` 查不到**：路径表用“目录规范号 + 文件名”作键，文件名里出现 `/` 会破坏语义；正常文件系统不会产生这种名字（同报告 `:93`）。
- **窄列旁表是稀疏结构**：超过 4 GiB 的文件写入旁表；旁表查询比主列慢，只是这类文件很少（`docs/audits/2026-10-22/allocator-narrow-columns/report.md:39`）。
- **分配器收益不可移植**：`MallocLargeCache=0` 是 macOS 的 `LSEnvironment` 配置，调试运行不读它；换平台/换分配器后 44.1% 的收益不会原样复现（`docs/audits/2026-10-22/allocator-narrow-columns/report.md:11,92`）。
- **短时观察**：GUI 只观察了约 3.5 分钟，未做长期驻留、保存/压缩峰值测试（`docs/audits/2026-10-22/path-table-dir-runs/report.md:90-92`）。

## 我能偷什么

1. **事件先翻译成“变更计划”**：把平台事件（FSEvents/usn/inotify）与索引更新解耦，核心只认 `Add/Remove/Update/RemoveTree`。
2. **目录级延迟重扫**：目录内文件成批变化时，与其逐条处理，不如 5 秒后重扫一次；用 debounce + 节流控制最坏成本。
3. **共享前缀池**：任何“大量长字符串共享前缀”的场景（路径、URL、模块名）都值得建组件树，而不是存完整字符串。
4. **窄列 + 旁表**：主流程用 32 位，少数溢出值走旁表；这是“99% 快路径 + 1% 精确路径”的经典组合。

**一句话记住：** FSEvents 保证索引只处理“变化”，池化/窄列/差分编码保证“变化之外的部分”不占内存；两者一起才让常驻全盘索引成为可能，也意味着任何一块退化都会直接反映在续航或内存上。
