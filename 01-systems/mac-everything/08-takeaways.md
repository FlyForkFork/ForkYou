# 08 可迁移想法与模拟面试

这篇回答什么问题：mac-everything 里哪些设计值得搬到别的项目，哪些只是它“单机、全盘、内存敏感”约束下的特解；以及把作者放在面试椅上，他该怎么为自己的取舍辩护。

## 一、可迁移想法

### 1. 先缩候选，再谈并行
- **问题**：600 多万条记录，纯并行扫描只能把固定成本摊薄，救不了“每条都验一遍”。
- **做法**：名称 trigram、正则 FilteredRE2 atoms、扩展名索引、路径段目录展开四路候选，取最小集；候选少于 1 万条时干脆单线程（`SearchEngineAdvancedQuery.cpp:629-750,790-791`）。
- **为什么好**：延迟由候选集大小决定，线程数只影响常数项；单线程还省掉调度和缓存抖动。
- **怎么用到我的项目**：先给查询/过滤写一个“候选来源与基数”估算，再决定要不要并行；没有候选收缩的并行通常是在加速错误的工作。

### 2. 让查询计划能自证
- **问题**：用户只感知“快/慢”，开发者不知道慢在哪一段。
- **做法**：`QueryTimingInfo` 固定输出 lockWait/trigram/phase1/phase2/sort/totalRecords/candidates/resultCount 等字段（`SearchEngine.h:86-101`），HTTP `timing` 原样返回（`HttpServer.cpp:409-520`）。
- **为什么好**：性能回归可以按字段归因，而不是靠猜；基准报告也能复现同一口径。
- **怎么用到我的项目**：给核心查询返回结构化 timing，比加一堆日志更便宜。

### 3. 持久化拆成“只读快照 + 追加日志”
- **问题**：每次变更都改大索引会写放大，每次启动都重建又太慢。
- **做法**：v6 十一节段扁平文件做只读快照（`FlatIndexWriter.h:35-51`），WAL 追加变更、按 15 分钟到 2 小时或 8/32 MB 阈值合并（`IndexPersistence.h:67-85`）。
- **为什么好**：读路径可以 mmap 零拷贝，写路径只碰日志；崩溃恢复边界清楚。
- **怎么用到我的项目**：读多写少、启动要快、内存有硬预算时，先考虑“列式快照 + 简单 WAL”，不要一上来就嵌入式数据库。

### 4. 内存优化要分“结构占用”和“分配器占用”
- **问题**：逻辑结构已经压得很紧，物理足迹仍下不来。
- **做法**：第六轮把结构压到约 121 MiB，剩余主要是分配器碎片；第七轮换分配器、收窄列、去 inode/devId，才从 1266.88 MiB 降到 708.25 MiB（`docs/changelog/146-resident-memory-optimization.md`、`docs/changelog/147-query-and-prefix-removal.md`）。
- **为什么好**：不算清账就继续改结构，可能白忙。
- **怎么用到我的项目**：先用 vmmap/Heaptrack 分账，再决定是改数据布局还是改分配策略。

### 5. 平台事件先翻译成领域操作，再批量落索引
- **问题**：FSEvents 回调频率高、语义粗，直接改索引会把平台细节扩散到各处。
- **做法**：`collectFSEventMutations` 统一翻译成 REMOVE/UPDATE/REMOVE_TREE + contentUpdates + rescanDirs，再一次 `batchMutate`（`ServiceEngine+FSEvents.cpp:44-147`）。
- **为什么好**：索引层只认领域操作，测试可以不开 FSEvents；同一批事件只拿一次写锁。
- **怎么用到我的项目**：文件监听、消息队列、CDC 都适用——先做事件翻译层，别让平台 API 长进核心。

### 6. 并发重写用代际校验，不只加互斥锁
- **问题**：COW 压缩在 Phase 2 无锁构建，等 Phase 3 拿锁时，世界已经变了。
- **做法**：`compactionGen_` 在提交前校验；不等就放弃，配合 `compactionMutex_.try_to_lock` 让后到者直接退出（`SearchEngine.cpp:594-595,715-718`）。
- **为什么好**：1.4.0 的事故证明，只加锁挡不住不走同一把锁的 `loadRecords`；代际校验才是最后防线。
- **怎么用到我的项目**：任何“快照—后台构建—切换”的流程，都加一个 generation/version 做提交前 CAS。

## 二、模拟面试卡（双 Agent：面试官出题，面试者作答，主 Agent 整理）

### 卡 1：为什么不用 USN Journal 那套？
**30 秒答案**：macOS 没有等价的“全盘可重放变更日志”。FSEvents 的路径事件可以合并、可以丢，丢了只给一个 MustScanSubDirs 让你重扫子树；所以我必须保留全量 v6 快照、准备全盘兜底，还要为 TCC 目录申请完全磁盘访问。两阶段启动也是这个约束的产物：先把列装进来可交互，trigram 在后台补。
**追问**：`sinceEventId` 不能续吗？——能续，但它不保证逐条不丢；USN 的 USN+FRN 才是逐变更事实。

### 卡 2：为什么自研 v6 + WAL，而不用 SQLite？
**30 秒答案**：硬指标是 573 MiB 物理足迹和秒级启动。v6 用列式 SoA、mmap 大段零拷贝、路径池共享前缀，SQLite 的页开销和二级索引很难压到这个量级。代价是自研 WAL 和压缩的并发窗口，1.4.0 已经付过一次学费。
**追问**：重新选呢？——快照保留 v6；WAL/随机更新可以换 SQLite WAL 或 LMDB，WAL 不再自研。

### 卡 3：两阶段启动怎么保证查询正确？
**30 秒答案**：`loadRecordsV6` 装完列就能回答“记录存在不存在”，此时 `phase2Pending_` 为真；`completePhase2` 在锁外建 trigram/扩展名/最近缓存，再拿锁换入，并把期间新增的记录和墓碑 replay 一遍（`SearchEngineV6.cpp:11-126`）。代价是 Phase 2 完成前名称候选缺失，查询会退化为扫描——正确性不受影响，延迟变差。
**追问**：换入时查询正在用旧索引怎么办？——`readViewForV6` 借列，配合 mutationGate_ 保证生命周期。

### 卡 4：FSEvents 丢事件怎么办？
**30 秒答案**：`MustScanSubDirs` 且不在排除目录时置 `journalTruncated_`，回放结束（或超时）后走后台全量重建；普通事件先 5 秒 debounce，再按 300 秒节流重扫目录（`FileSystemWatcher.cpp:177-213`、`ServiceEngine.cpp:225-315`）。这里有个已知缺口：`setEarlyAbortSemaphore` 只有定义没有调用点，回放失败仍要等满 10 秒超时。
**追问**：持续事件风暴有最坏延迟上界吗？——没有；debounce 每次重置定时器，当前实现不保证上界（待查实/需改成固定窗口）。

### 卡 5：1.4.0 的压缩事故根因是什么？
**30 秒答案**：两个压缩入口——定时 flush 的 fullCompact 和 rescanSubtree 的墓碑回收——都拿到同一份旧快照。第一个提交后记录号和目录号全部重编号，第二个用旧键去 probe 新 `pathIndex_`，全部失配，把约 647 万条活记录标成墓碑，日志是 `replayed 0 adds, 6472797 deletes`，存活从 650 万掉到 24,741（`docs/changelog/153`）。修复是 try_to_lock 单飞 + Phase 3 校验 `compactionGen_`；只加锁不够，因为 `loadRecords` 根本不走那把锁。
**追问**：后到者直接放弃，墓碑怎么办？——留在内存和下次 fullRewrite 的 v6 里，等下一轮压缩回收。

### 卡 6：查询为什么能到亚毫秒？
**30 秒答案**：热查询走名称 trigram 或扩展名候选，候选少就单线程，每线程维护局部 Top-K 堆，单 SUBSTRING 有专用模板，纯 filter 用 16 路 SIMD 存活掩码（`SearchEngineAdvancedQuery.cpp:759-871`）。README 的 `*.swift 0.93 ms / readme 6.13 ms` 是作者本机固定快照的 5 次中位数，不是所有机器。
**追问**：最坏呢？——宽路径查询 34–58 ms；`path:` 前缀大目录仍可能退化为目录展开后扫描。

### 卡 7：573 MiB 是怎么算的，能信吗？
**30 秒答案**：它是固定快照 6,381,948 条有效记录的 Mach 物理足迹（`docs/audits/2026-10-22/path-table-dir-runs/`），不是 RSS，也不是所有场景的常驻上限。七轮优化是各自独立的前后对比，不能相加：3712.61→2372.72→1943.39→1882.89→1573.28→1268.56→708.25→573.0 MiB。审计自己也说，没证明全盘重建、压缩、全文索引时始终低于 1 GiB。
**追问**：拿哪个数做预算？——同一快照、同一口径的 footprint 和 P95 查询延迟，不用峰值冒充常驻。

### 卡 8：main 的“重建索引”有什么问题？
**30 秒答案**：GUI 菜单删的是 `index.bin/index.wal/index.pages/index.ptable`，唯独不删 `index.v6`（`SearchViewModel.swift:214-218`）；而 `IndexPersistence::load` 先试 v6（`IndexPersistence.cpp:33-44`），所以点完重建还是加载旧索引。HTTP `/api/index/rebuild` 只 postNotification，全仓没有监听者（`HttpServer.cpp:585-590`、`MacSearchBridge.mm:231-234`），等于什么都不做。分支 `fix/rebuild-index-v6` 用 `ServiceEngine::rebuildIndex` 修了：防重入、停持久化、删 v6+WAL+旧格式+内容索引，再全扫（`origin/fix/rebuild-index-v6:MacEverything/Core/ServiceEngine.cpp:406-440`），但还没合并。
**追问**：为什么先停 persistence？——自动 flush 的 timer 可能在删完后把内存旧记录又写回 v6。

### 卡 9：MCP 为什么不独立进程？
**30 秒答案**：MCP 只是薄适配器：stdio JSON-RPC 四个工具，全部转发到 GUI 进程内的 `127.0.0.1:19860`。好处是索引只有一个写者，GUI、daemon、MCP 不需要跨进程锁；代价是 GUI 崩溃时 MCP 请求全部失败，没有重试队列。要 7×24 就得让独立 daemon 托管引擎，但 GUI 和 daemon 不能同时抢 19860。
**追问**：为什么不 XPC？——XPC 要处理跨进程生命周期、共享内存和崩溃恢复，换来的只是入口隔离；对这个规模不划算。

### 卡 10：如果重做，你会怎么选？
**30 秒答案**：保留 v6 列式快照，因为 573 MiB 是硬约束；把自研 WAL 换成 SQLite WAL 或 LMDB 事务日志，records 表按路径主键、自建 trigram posting，查询层仍自己做候选竞争。WAL 的 fsync、checkpoint、崩溃恢复不再自研——1.4.0 的事故说明这个并发窗口不值得再写一遍。
**追问**：SQLite 能压到 573 MiB 吗？——不能保证；所以它只替换 WAL，不替换只读快照。

## 三、吹 B 一句话（都有出处）

1. 640 万条记录、573 MiB 物理足迹，热查询 0.93 ms——作者本机固定快照，不是嘴炮。
2. 七轮内存优化把 3.7 GiB 压到 573 MiB，靠的是目录池、名称共享、差分倒排和一列一列地抠。
3. 1.4.0 把 650 万条索引压成 24,741 条的事故，最后定位到“快照到提交之间的 generation 窗口”，两条修复都进了主干。
4. 11 段 v6 格式 + 50 MB WAL，启动加载 2.43 s、FSEvents 回放 0.13 s，这是审计报告里的数。

## 四、局限与不该抄的地方

- **别轻易自研 WAL + 压缩**：除非你有同样硬的内存预算和同样多的测试；这次事故的根因是并发窗口，不是代码风格。
- **Makefile 不跟踪头文件依赖**：只列 `$(CORE_SRCS)` 的 `.cpp`，改头文件不一定触发重编（`Makefile:12-13`）。
- **版本号三处靠人同步**：`Info.plist` 是 1.4.0，`ServiceEngine.h:175` 的 `kAppVersion` 还写着 "1.1.0"（推断：只进索引元数据，不影响显示）；AGENTS.md 要求每次改版本同步 About 与 changelog。
- **main 的 rebuild 两条路径都失效**（截至 0db6b601），分支修了但未合并；不要把“有按钮”当成“有功能”。
- **宽路径查询仍是几十毫秒**：`MacEverything/a` 34.62 ms、`site-packages/a` 49.96 ms、`my_product/a` 57.95 ms；审计也未证明长期驻留/全盘重建始终低于 1 GiB。
- **死代码要清**：`FileSystemWatcher::setEarlyAbortSemaphore` 只有定义和内部使用，没有调用者；FSEvents 回放失败仍等 10 秒超时。
- **行号会漂**：本文所有 `文件:行号` 以 `0db6b601` 为准；分析快照是 2026-11-10 的 5 个分支，之后的新提交未覆盖。

一句话记住：这个项目真正值得抄的不是 11 段文件格式，而是“先缩候选、按快照重写、用代际校验兜并发”这三件事。
