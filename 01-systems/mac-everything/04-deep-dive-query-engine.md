# 04 深挖二：查询解析与搜索引擎

> 这篇回答什么问题：一条 `ext:swift path:MacEverything size:>1mb` 的查询，怎样在几毫秒内落到几百万条记录上，以及哪些查询它其实也快不起来。

## 问题

查询语法要同时满足三件事：

- **像 Everything**：空格即 AND、`|` 是 OR、`!` 是 NOT、`<...>` 分组、`ext:`/`size:`/`dm:` 等过滤器。
- **快**：候选集必须在扫全表之前缩到很小；否则 600 万条 × 每条约 50 字节的名字比较也要几百毫秒。
- **可取消**：用户连续输入时，旧查询必须尽快退出，不能占满 CPU。

## 朴素做法为什么不够

| 做法 | 问题 |
|---|---|
| `std::regex` 逐条匹配 | 每条记录构造/匹配一次，600 万次正则，且回溯不可控 |
| 全路径字符串逐条 `find` | 每次都要拼接 `path + "/" + name`，分配和拷贝吃掉大部分预算 |
| 只做前缀匹配 | 无法表达 `*foo*`、`foo|bar`、`!node_modules` |
| 每次查询都扫全表 | 简单查询也要 600 万次比较，0.9 ms 不可能达到 |

## 这个项目怎么做

### 第一步：手写 tokenizer，而不是正则切词

`QueryTokenizer::tokenize` 逐字符扫描，产出 `WORD / QUOTED / PIPE / BANG / LANGLE / RANGLE / FILTER / END`（`MacEverything/Core/QueryTokenizer.h:33-133`）。关键点：只有名字在已知过滤器集合里才拆成 `FILTER`，否则 `C:\Users` 这种路径里的冒号会被误判（`MacEverything/Core/QueryTokenizer.h:163-182`）。白名单覆盖 `ext/size/file/folder/path/nopath/parent/depth/len`、`dm/dc/da`、`case/nocase/regex/ww/wfn`、`audio/video/pic/doc/exe/zip` 等宏。

### 第二步：递归下降生成 AST

语法是 `or_expr → and_expr → not_expr → atom`：`parseOrExpr` 处理 `|`，`parseAndExpr` 把连续项当隐式 AND，`parseNotExpr` 处理 `!`，`parseAtom` 处理 `<...>` 分组、引号、过滤器和普通词（`MacEverything/Core/QueryParser.h:21-29`）。AST 节点只有五种：`TERM / AND / OR / NOT / FILTER`，`TERM` 上带 `MatchMode`（`SUBSTRING / GLOB / REGEX / WHOLEWORD / WHOLEFILENAME`）和预编译的 `CompiledGlob`（`MacEverything/Core/QueryAST.h:10-52`）。

### 第三步：三个语义变换

`queryAdvanced` 在求值前做：

1. `transformSlashTerms`：把 `MacEverything/a` 这种含 `/` 的 TERM 变成路径段约束 + 剩余文件名条件。
2. `transformGlobTerms`：含 `*`/`?` 的 TERM 从 SUBSTRING 改成 GLOB 模式，并预编译成 `CompiledGlob` 以便零分配匹配（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:315-324`）。
3. `analyzeQueryNeeds`：分析查询到底需要 path、original case 还是纯元数据，后续循环按需读取，避免无谓的路径还原。

正则节点在拿锁前统一预编译成 RE2，每线程再克隆一份缓存；非法正则不会崩溃，`evalTerm` 直接返回 false（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:108-126`、`:594-609`）。源码注释记录了一个实测结论：多个线程共享同一个 RE2 对象时，12 线程比 1 线程慢约 6 倍（DFA 内部锁竞争），每线程克隆后拿到约 3.8 倍的多线程加速。这条注释是整个查询引擎里最有价值的一条工程经验。

### 第四步：四路候选，取最小

- **名称 trigram（Stage 1）**：`intersectPostingLists` 取所有三元组 posting 的交集；必须“所有 trigram 都存在”且候选 ≤ 总数的 1/10 才采用，否则清空（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:629-639`）。被跳过时会打一条 `DIAG-TRIGRAM`，写明 `allFound=false` / `tooManyCands` / `indexEmpty` / `phase2Pending` 等具体原因（`:641-655`）——这是排查“为什么这条查询没走索引”的唯一入口。
- **正则 trigram（Stage 2）**：名称失败时，用 `FilteredRE2` 从正则里抽字面量，按**并集**取候选（因为 `foo|bar` 的 atoms 是 OR 关系），同样受 1/10 约束（`:657-669`）。
- **扩展名索引（Stage 4）**：`ext:` 多值取并集后去重；扩展名索引是精确的，空集就是真的没有匹配，所以 `extOk = true` 不看大小（`:671-690`）。
- **路径段扫描**：没有名称/扩展名候选、且 Phase 2 已完成时，沿 `DirectoryPool` 的目录树逐目录 `matchesSegments`，命中目录再用 `pathIdxToRecords_.forEach` 展开记录；候选超过总数 1/4 就整体放弃（`:697-722`）。

最后把可行候选集按大小排序取最小（`:724-750`）。这个“竞选”设计的价值在于：任何单一路径在宽查询上都会失效，但失效方式不同——trigram 是候选爆炸，扩展名是精度不足，路径是线性目录遍历；取最小相当于在运行时自动选择当前数据分布下最划算的策略。

### 第五步：并行扫描 + 每线程 Top-K

线程数按工作量决定：候选 <10,000 时单线程，否则 `hardware_concurrency` 截到 1–32（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:790-791`）。每个 worker 用 `DirectoryPool::Cursor` 缓存父路径，每 1,024 条检查一次取消代数，并提前 8 条预取 `types_` 与名称池（`:807-814`）。

扫描循环用 C++20 模板按 `Simple`/`CaseSensitive` 编译期特化：单条件子串用 `simdContains`，复杂 AST 才走 `evalNode`；纯元数据过滤再用 `simdTypeLive16` 一次检查 16 条记录的存活位掩码（`:801-871`）。**名称命中后不再拼路径**——只有 `!astPtr->nameOnly` 时才构造 `path + "/" + name` 再比一次，这是 win-inspired 那轮最主要的收益来源之一（`docs/audits/2026-10-22/win-inspired/report.md:22-24`）。

每个 worker 只保留最好的 K 条：`RankedMatches` 用 `std::push_heap`/`pop_heap` 维护小顶堆，比较器是 `priority → pathLen → idx`；纯 filter 查询因为结果天然按 ID 升序，直接“取满 K 就停”（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:759-781`、`:856-871`）。合并后先释放共享锁再排序，`partial_sort` 只排前 K（`:883-898`）。

### 第六步：结果优先级与排序

`priority` 的含义：0 表示名称完全相等、1 表示名称前缀命中、2 表示名称包含、3 表示只有路径命中（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:836-842`）。同一个词在名字里出现，永远排在“只在父目录里出现”的结果前面——这解释了为什么搜 `swift` 时 `SwiftUI.swift` 比 `swift-tools/README.md` 更靠前。

### 取消为什么按 session 而不是全局

HTTP 请求和 GUI 输入是两条独立的查询流：如果共用一个 generation，用户在输入框打字会把正在跑的 HTTP 查询一起取消。`acquireSessionGeneration` 为每个 session 维护一个原子计数，`sessionId=0` 的查询拿到一个无人检查的 dummy 原子，永不取消（`MacEverything/Core/SearchEngineQuery.cpp:255-268`、`:270-277`）。这是“多入口共用一个引擎”时必须提前设计的隔离点。

### DIR_LIST 是一条单独的捷径

`/Applications/*` 这类查询不进 `queryAdvanced`：`query` 先 parse，发现 `QueryMode::DIR_LIST` 就走 `queryDirList`——按目录名精确定位目录记录，拼出完整目录路径，再用 `pathLookup_` 找到目录的路径编号，最后 `pathIdxToRecords_.forEach` 直接取子项（`MacEverything/Core/SearchEngineQuery.cpp:53-135`、`:196-201`）。这比“扫全表再按路径前缀过滤”少几个数量级的工作，也是 `/Applications/` 只要 5.37 ms 的原因（`docs/audits/2026-10-22/path-table-dir-runs/after.txt`）。

## 代码证据

| 结论 | 证据 |
|---|---|
| tokenizer 手写、过滤器白名单 | `MacEverything/Core/QueryTokenizer.h:33-182` |
| 递归下降 AST，隐式 AND | `MacEverything/Core/QueryParser.h:21-29`、`MacEverything/Core/QueryAST.h:10-52` |
| 名称 trigram 候选必须 ≤total/10 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:629-639` |
| 正则 trigram 用并集、扩展名索引精确 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:657-690` |
| 路径候选与 1/4 上限 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:697-722` |
| 单条件编译期特化 + SIMD + 16 路 liveness | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:801-871` |
| 每线程 Top-K + 排序键 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:759-781`、`:883-898` |
| 每 session 独立取消 | `MacEverything/Core/SearchEngineQuery.cpp:255-277` |
| DIR_LIST 单独捷径 | `MacEverything/Core/SearchEngineQuery.cpp:53-135` |

## 复杂度/性能边界

| 查询类型 | 主要成本 | 实测（固定快照，5 次中位数） |
|---|---|---|
| `*.swift`（名称 trigram） | trigram 交集 + 候选验证 | 0.93 ms，1145 条（`after.txt`） |
| `readme`（名称 trigram） | 同上，候选更多 | 6.13 ms，上限 10000 条 |
| `size:>1mb`（纯元数据） | 全表并行过滤 | 2.12 ms |
| `type:folder` | 全表并行 + liveness 位掩码 | 2.09 ms |
| `path:MacEverything ext:swift` | 扩展名索引直接命中 | 0.049 ms，81 条 |
| `/Applications/` | DIR_LIST 捷径 | 5.37 ms，13 条 |
| `MacEverything/a` | 目录树扫描 + 记录展开 | 34.62 ms，632 条 |
| `site-packages/a` | 同上，目录更大 | 49.96 ms，上限 10000 条 |
| `my_product/a` | 同上，候选更多 | 57.95 ms |

数据来自 `docs/audits/2026-10-22/path-table-dir-runs/after.txt`（同目录 `report.md` 给出快照指纹 46b8eb2f7e52153d，6,460,706 记录位置 / 6,381,948 有效）。结论：**有选择性索引的查询在毫秒级；宽路径查询仍是几十毫秒**。README 自己也标注“较宽的目录查询可能需要数十毫秒”（`README.md:47`）。

## 取舍与局限

- **1/10 与 1/4 都是启发式阈值**：候选太多时宁可不走索引，直接全扫；结果正确，但延迟会退化。没有基准驱动的自动调参，不同数据规模下最优值会变。
- **trigram 只对 ≥3 字符有效**：两字符查询提取不出 trigram，直接退化为线性扫描（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:629`）。
- **宽路径查询是明确的弱点**：`my_product/a` 57.95 ms，比热查询慢 60 倍；路径段扫描是线性目录遍历，不是 trigram。
- **Phase 2 未完成时**：路径候选分支被 `phase2Pending_` 短路，部分查询只能线性扫描（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:697-698`）。
- **正则仍可能慢**：RE2 保证线性时间，但复杂正则 + 大候选集仍要逐条求值；`FilteredRE2` 只能抽字面量，不是所有正则都能提取。
- **结果上限会改变路径**：`maxResults=0`（无限制）会保留全部命中，Top-K 的常数内存优势消失；这是“上限查询”和“全量查询”两条不同的成本曲线。
- **regex 每线程 clone 是内存换速度**：线程数越高，缓存副本越多；32 线程时这份缓存本身也不便宜（推断：项目未给出该场景的内存测量）。
- **候选阈值不会自适应**：1/10 与 1/4 是固定常量，遇到“高频词 + 宽目录”会同时失效并退化为全表扫描；要改进只能先收集每路 posting 基数与单条验证成本，做代价模型，而不是继续拍阈值。

## 我能偷什么

1. **先变换再求值**：把 `/`、glob 这类“语法糖”在 AST 层转成结构化约束，执行器只面对少量节点类型。
2. **候选集竞争**：不要迷信某一种索引；名称、正则、扩展名、路径四路都算，取最小的，简单且稳。
3. **每线程 Top-K**：并行查询不要先合并全部命中再排序，内存和排序成本都会爆炸。
4. **编译期特化常见路径**：`Simple`/`CaseSensitive` 两个布尔就能让最常见查询走无分支循环。
5. **按 session 隔离取消**：多入口共用引擎时，每个入口一条 generation，互不误杀。
6. **给“为什么没用索引”留一条诊断日志**：`DIAG-TRIGRAM` 把跳过原因分成 4 类并打印阈值与候选数，排查性能回归时省掉大量猜测。

**一句话记住：** 查询引擎的核心不是“并行”，而是先用 trigram/正则字面量/扩展名/目录树把 600 万条变成几千条，再并行验证这几千条；真正拖慢它的，恰好是那些哪条索引都用不上的宽路径查询。
