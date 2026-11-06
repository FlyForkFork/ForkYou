# 04 深挖二：查询解析与搜索引擎

> 这篇回答：一条 `ext:swift path:MacEverything size:>1mb` 的查询，怎样在几毫秒内落到几百万条记录上。

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

**第一步：手写 tokenizer，而不是正则切词。**

`QueryTokenizer::tokenize` 逐字符扫描，产出 `WORD / QUOTED / PIPE / BANG / LANGLE / RANGLE / FILTER / END`（`MacEverything/Core/QueryTokenizer.h:33-133`）。关键点：只有 `name:` 在已知过滤器集合里才拆成 `FILTER`，否则 `C:\Users` 这种路径里的冒号会被误判（`:96-125`、`:163-182`）。`hasAdvancedSyntax` 先做一次快速判断，普通查询可以走更轻的路径（`:137-160`）。

**第二步：递归下降生成 AST。**

语法是 `or_expr → and_expr → not_expr → atom`：`parseOrExpr` 处理 `|`，`parseAndExpr` 把连续项当隐式 AND（遇 `PIPE`/`RANGLE` 停止），`parseNotExpr` 处理 `!`，`parseAtom` 处理 `<...>` 分组、引号、过滤器和普通词（`MacEverything/Core/QueryParser.cpp:32-139`）。

**第三步：三个语义变换。**

`queryAdvanced` 在求值前做：

1. `transformSlashTerms`：把 `MacEverything/a` 这种含 `/` 的 TERM 变成路径段约束 + 剩余文件名条件（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:583-585`）。
2. `transformGlobTerms`：含 `*`/`?` 的 TERM 从 SUBSTRING 改成 GLOB 模式（`:587-588`）。
3. `analyzeQueryNeeds`：分析查询到底需要 path、original case 还是纯元数据，后续循环按需读取，避免无谓的路径还原（`:590-592`）。

正则节点在拿锁前统一预编译成 RE2，每线程再克隆一份缓存；非法正则不会崩溃，`evalTerm` 直接返回 false（`:594-609`）。

**第四步：三路候选，取最小。**

- 名称 trigram：`intersectPostingLists` 取所有三元组 posting 的交集；只有“所有 trigram 都存在”且候选 ≤ 总数的 1/10 才采用（`:629-636`、`MacEverything/Core/SearchEngineIndex.cpp:10-43`）。
- 扩展名索引：`ext:` 的多个值取并集，扩展名索引是精确的，空集就是真的没有（`:671-690`）。
- 路径段扫描：没有名称/扩展名索引时，沿 `DirectoryPool` 的目录树匹配路径组件，再把该目录下所有记录展开为候选；超过总数 1/4 就放弃（`:694-722`）。

最后把三路可行候选按大小排序，取最小的那个（`:724-750`）。

**第五步：并行扫描 + 每线程 Top-K。**

线程数按工作量决定：候选 <10,000 时单线程，否则 `hardware_concurrency` 截到 1–32（`:791`）。每个 worker 用 `DirectoryPool::Cursor` 缓存父路径，按 1,024 条检查 generation 取消，提前 8 条预取 `types_` 和名称池（`:801-811`）。

扫描循环用 C++20 模板按 `Simple`/`CaseSensitive` 编译期特化：单条件子串用 `simdContains`，复杂 AST 才走 `evalNode`；纯元数据过滤再用 `simdTypeLive16` 一次检查 16 条记录的 liveness 位掩码（`:801-871`）。每个 worker 只保留最好的 K 条（小顶堆），合并后按 `priority → pathLen → idx` 排序（`:760-781,887-898`）。

**为什么不让所有查询都走 trigram？** 因为 trigram 只对“名字里连续出现的三个字符”有效。`size:>1mb`、`type:folder` 这类纯元数据查询没有名字可查；`a`、`ab` 这种短词也提取不出 trigram；`path:` 约束针对的是目录而不是文件名。项目把这三类分开处理：纯元数据走全表并行，短词走线性扫描，路径走目录树候选。

**`analyzeQueryNeeds` 的意义**：它把查询分成“只需要名字”“需要路径”“需要原始大小写”等组合，扫描循环据此决定是否调用 `buildFullPathBuf`。路径拼接是查询里最贵的单条操作之一，能少拼一次就少拼一次（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:590-592,830-835`）。

**取消为什么按 session 而不是全局？** 因为 HTTP 请求和 GUI 输入是两条独立的查询流：如果共用一个 generation，用户在输入框打字会把正在跑的 HTTP 查询一起取消。`acquireSessionGeneration` 为每个 session 维护一个原子计数，`sessionId=0` 的查询永远不取消（`MacEverything/Core/SearchEngineQuery.cpp:256-277`）。这是“多入口共用一个引擎”时必须提前设计的隔离点，也解释了为什么 HTTP 查询不会被 GUI 输入误杀。

## 代码证据

| 结论 | 证据 |
|---|---|
| tokenizer 手写、30+ 过滤器白名单 | `MacEverything/Core/QueryTokenizer.h:33-182` |
| 递归下降 AST，隐式 AND | `MacEverything/Core/QueryParser.cpp:32-139` |
| 名称 trigram 候选必须 ≤total/10 | `MacEverything/Core/SearchEngineAdvancedQuery.cpp:629-636` |
| 扩展名/路径候选与最小集选择 | 同上 `:671-750` |
| 单条件编译期特化 + SIMD | 同上 `:801-848` |
| 每线程 Top-K + 排序键 | 同上 `:760-781,887-898` |
| 每 session 独立取消 | `MacEverything/Core/SearchEngineQuery.cpp:256-277` |

## 复杂度/性能边界

| 查询类型 | 主要成本 | 实测 |
|---|---|---|
| `*.swift`（名称 trigram） | trigram 交集 + 候选验证 | 0.93 ms（README.md:247） |
| `readme`（名称 trigram） | 同上，候选更多 | 6.13 ms（README.md:248） |
| `size:>1mb`（纯元数据） | 全表并行过滤，无候选 | 2.12 ms（README.md:249） |
| `type:folder` | 全表并行 + liveness 位掩码 | 2.09 ms（README.md:250） |
| `path:MacEverything ext:swift` | 扩展名索引直接命中 | 0.05 ms（README.md:251） |
| `MacEverything/a` | 目录树扫描 + 记录展开 | 34.62 ms（README.md:252） |

结论：**有选择性索引的查询在毫秒级；宽路径查询仍是几十毫秒**。README 自己也标注“较宽的目录查询可能需要数十毫秒”（`README.md:47`）。

## 取舍与局限

- **1/10 是启发式阈值**：候选太多时宁可不走 trigram，直接全扫；结果正确，但延迟会退化。这是“避免为窄查询建大候选数组”的取舍。
- **trigram 只对 ≥3 字符有效**：两字符查询直接退化为线性扫描（`MacEverything/Core/SearchEngineIndex.cpp:15-17` 的 `extractTrigrams` 为空即 `allFound=false`）。
- **路径扫描有 1/4 上限**：宽路径查询会放弃候选集，回到全表；所以 `MacEverything/a` 需要 34.62 ms。
- **Phase 2 未完成时**：`pathCands` 分支被 `phase2Pending_` 短路，部分查询只能线性扫描（`MacEverything/Core/SearchEngineAdvancedQuery.cpp:697`）。
- **正则仍可能慢**：RE2 保证线性时间，但复杂正则 + 大候选集仍要逐条求值；项目用 `FilteredRE2` literals 做预过滤，但不是所有正则都能提取字面量（`:657-669`）。

## 我能偷什么

1. **先变换再求值**：把 `/`、glob 这类“语法糖”在 AST 层转成结构化约束，执行器只面对少量节点类型。
2. **候选集竞争**：不要迷信某一种索引；名称、扩展名、路径三路都算，取最小的，简单且稳。
3. **每线程 Top-K**：并行查询不要先合并全部命中再排序，内存和排序成本都会爆炸。
4. **编译期特化常见路径**：`Simple`/`CaseSensitive` 两个布尔就能让最常见查询走无分支循环。
5. **按 session 隔离取消**：多入口共用引擎时，每个入口一条 generation，互不误杀。

**一句话记住：** 查询引擎的核心不是“并行”，而是先用 trigram/扩展名/目录树把 600 万条变成几千条，再并行验证这几千条。
