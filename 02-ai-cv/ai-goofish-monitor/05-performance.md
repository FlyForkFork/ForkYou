# 05 性能：时间花在哪，以及一个真实的 O(n) 分页陷阱

## 这篇回答什么问题

- 一个监控任务从点「启动」到出结果，时间到底花在哪。
- 并发上限由什么决定，能不能调大。
- 前端每翻一页结果，后端做了什么——这里有个值得说的实现。
- 没有 benchmark 的项目，怎么用代码里的常量算出容量。

## 性能敏感路径清单

| # | 路径 | 敏感度 | 依据 |
|---|---|---|---|
| 1 | 抓取循环（含所有 sleep） | **极高**，占总时长 90%+ | `src/scraper.py:1000-1200` |
| 2 | 详情页抓取（每商品一次 goto） | 高，25 秒超时 | `src/scraper.py:1035-1041` |
| 3 | AI 分析（每商品一次多模态请求） | 高，秒级~十几秒 | `src/ai_handler.py:376-479` |
| 4 | 结果分页查询 | **中，但是 O(n)** | `src/services/result_storage_service.py:280-305` |
| 5 | Dashboard 聚合 | 中，O(文件数 × 行数) | `src/services/dashboard_service.py:37-64` |
| 6 | 图片下载 + base64 编码 | 中 | `src/ai_handler.py:117-200` |
| 7 | 日志 tail 读取 | 低（按块倒读） | `src/api/routes/logs.py:18-52` |

## 时间都花在睡觉上

把 `src/scraper.py` 里所有 `random_sleep` 调用列出来：

| 位置 | 时长 | 触发频率 |
|---|---|---|
| `:465` | 2–4 s | 每页 1 次（等首页商品 API） |
| `:480` | 3–5 s | 每页 1 次（等评价 API） |
| `:698,702,737` | 1–3 s | 开场热身约 4 次 |
| `:799-963` | 1–4 s | 每个筛选动作 1 次，约 15 次 |
| `:1029` | 2–4 s | **每商品 1 次** |
| `:1167` | 5–10 s | **每商品 1 次** |
| `:1191` | 2–4 s | **每商品 1 次** |
| `:1198` | 10–15 s | 每页 1 次 |

单商品固定开销 = 3 + 7.5 + 3 = **13.5 秒**（取中位数）。
单页额外 = 3 + 4 + 12.5 = **19.5 秒**。

一个 10 页 × 20 商品的任务：

```
10 页 × 20 商品 × 13.5 s  = 2700 s
10 页 × 19.5 s            =  195 s
筛选与热身                 ≈   40 s
─────────────────────────────────
纯睡眠                     ≈ 2935 s ≈ 49 分钟
```

再加上真实网络与 AI 时间（假设每商品 AI 3 秒，2 并发 → 20×10×3/2 = 300 秒），**总时长约 54 分钟**。

对照 `max_pages` 默认值 3（`src/domain/models/task.py:168`，`TaskCreate.max_pages: int = 3`）：默认配置下一次任务约 16 分钟。

**结论：这个项目的性能不是「快慢」问题，而是「故意慢」**。所有优化抓取速度的尝试都会直接降低账号存活率，见 04 深挖。

## 并发上限由什么决定

| 层 | 并发度 | 可调 | 代码 |
|---|---|---|---|
| 任务（子进程） | 无上限（每个任务一个进程） | 靠 CPU/内存与账号数 | `src/services/process_service.py:111-117` |
| 抓取 | **1**（严格串行） | 不可调，代码里没有并发抓取 | — |
| AI 分析 | 默认 **2** | 任务级 `ai_analysis_concurrency` 或环境变量 `AI_ANALYSIS_CONCURRENCY` | `src/scraper.py:275-278` |
| 卖家资料加载 | 与 AI 同一信号量 | 同上 | `src/services/item_analysis_dispatcher.py:35-40` |
| 通知 | 渠道数（最多 7） | `asyncio.gather` 全并发 | `src/services/notification_service.py:80-85` |
| 图片下载 | 默认 **3** | 参数 `concurrency` 或环境变量 `IMAGE_DOWNLOAD_CONCURRENCY` | `src/ai_handler.py:60-63`、`:147-200` |

为什么 AI 并发默认只有 2？两个约束：

1. **模型供应商的 rate limit**。多模态请求 token 大，并发一高就 429。
2. **抓取速度本来就是瓶颈**。抓一个商品要 13.5 秒，AI 分析 3 秒，2 并发足够跟上——调大只是让队列更空。

推断：`AI_ANALYSIS_CONCURRENCY` 调到 4-8 在有 quota 的情况下能缩短尾部等待（`join()` 阶段），但对总时长影响很小。

## 内存与磁盘

| 资源 | 量级 | 依据 |
|---|---|---|
| 每子进程 Chromium | 200–400 MB | 推断：常规 headless Chromium |
| 每商品图片临时文件 | 若干 MB，分析后立即删 | `item_analysis_dispatcher.py:143-144` |
| 商品 JSON（含 base64 图） | 单请求 1–5 MB | 推断：3-5 张图 × 几百 KB |
| SQLite 主库 | 单行 `raw_json` 含完整记录 | `result_storage_service.py:186-196` |

**图片的生命周期很短**：下载 → base64 → 分析 → `finally` 删除（`item_analysis_dispatcher.py:143-144`）。所以 `images/` 不会无限增长，代价是「重复分析同一商品要重新下载」——但去重机制让同一商品只分析一次。

**SQLite 存的是完整 JSON**：`result_items.raw_json` 保存整条记录（含卖家信息、AI 分析、价格参考），而不是拆成列。列只存了能排序/过滤的字段。这是**「关系表 + 文档列」混合模式**——查询快，但读取要反序列化整条 JSON。

## 一个真实的 O(n) 分页陷阱

这是本次分析最值得记录的一处实现细节。

### 症状

`GET /api/results/{filename}?page=1&limit=20` 看起来是标准分页，但实现是：

```python
# src/services/result_storage_service.py:280-305
def _query_result_records_sync(filename, ..., page, limit, include_hidden):
    bootstrap_sqlite_storage()
    offset = max(page - 1, 0) * limit
    with sqlite_connection() as conn:
        records = _load_filtered_records_from_conn(conn, filename=filename, ...)
    total = len(records)
    return total, records[offset: offset + limit]
```

而 `_load_filtered_records_from_conn`（`:114-147`）做的是：

```python
rows = conn.execute(f"SELECT raw_json, status FROM result_items WHERE {where} ORDER BY {order}").fetchall()
records = []
for row in rows:
    record = _parse_raw_record(str(row["raw_json"]), status=row["status"])   # json.loads 每一行
    decorated = _decorate_record_visibility(record, row["status"], blacklist_keywords)
    if include_hidden or _is_record_visible(decorated):
        records.append(decorated)
```

**没有 SQL `LIMIT`/`OFFSET`**。每次翻页都：

1. 把该 filename 下**所有行**取出来
2. 对**每一行**做 `json.loads`（单行可能几 KB 到几十 KB）
3. 逐条做黑名单可见性计算
4. 在 Python 里切片取 20 条

复杂度：**O(N) 时间 + O(N) 内存，N = 该关键词的累计商品数**，且与 `limit` 无关。

### 为什么要这么写

看 `_sort_expression`（`:69-72`）：

```python
def _sort_expression(sort_by, sort_order):
    column = SORT_COLUMN_MAP.get(sort_by, SORT_COLUMN_MAP["crawl_time"])
    direction = "ASC" if sort_order == "asc" else "DESC"
    return f"(CASE WHEN status = 'active' THEN 0 ELSE 1 END), {column} {direction}, id {direction}"
```

排序键第一项是 `CASE WHEN status = 'active' THEN 0 ELSE 1 END`——**「有效记录排前面」**。而「有效」还要叠加黑名单关键词过滤（`_decorate_record_visibility`，`:93-108`），黑名单来自另一张表 `result_blacklist_rules`，且匹配逻辑在 Python 里（`match_blacklist_keywords`）。

所以「先分页再过滤」会得到错误的页边界（第 2 页可能只有 5 条）。**必须全量过滤后才能分页**——这在语义上是对的。

### 代价与替代方案

| 方案 | 改动量 | 收益 | 代价 |
|---|---|---|---|
| 现状 | 0 | 语义正确 | 每次翻页全表扫 + 全量 JSON 解析 |
| 把黑名单匹配下推成 SQL `LIKE` | 中 | 能用 SQL LIMIT | 语义漂移（子串匹配 vs 分词匹配） |
| 加 `is_visible` 物化列，写时算好 | 小 | SQL 可 LIMIT | 黑名单规则变更时要批量重算 |
| 前端一次性拉全量 + 本地分页 | 小 | 只扫一次 | 首次加载慢，内存压力给浏览器 |
| 加一层「filename + 过滤条件 → item_ids」的缓存 | 中 | 重复翻页命中缓存 | 失效策略复杂 |

**这是典型的「正确性优先于性能」的取舍**。单用户自部署、单关键词几百到几千条，O(N) 全扫在 10-50 ms 量级，实际感知不到。但如果有人用它盯一个宽泛关键词（比如「iPhone」）跑几个月，`result_items` 可能上万行，每翻一页都要几百毫秒。

`推断：` 这也是为什么项目没有做「跨关键词全局搜索」——那样 N 会变成全表。

### 同样的模式在别处

`_load_result_summary_sync`（`:365-403`）和 `load_visible_result_item_ids`（`:457-475`）也是全量加载 + Python 过滤。

最重的是 Dashboard：

```python
# src/services/dashboard_service.py:45-51
for filename in await list_result_filenames():
    summary, activities, file_latest_time = await summarize_result_file(filename, task_lookup)
```

**对每个结果文件调一次全量加载**。10 个关键词 × 每个 2000 行 = 每次打开首页解析 2 万条 JSON。

而且 Dashboard 没有缓存，前端每次进页面都重新算。`推断：` 这是首页在数据多时变慢的主要原因。

## 做得好的地方

| 手法 | 位置 | 说明 |
|---|---|---|
| 阻塞 IO 全部 `asyncio.to_thread` | `result_storage_service.py` 每个 async 函数 | SQLite 是同步库，不线程化会阻塞事件循环 |
| 日志按块倒读 | `logs.py:18-52` | 从文件尾往前读 8 KB 块，不加载整个日志文件 |
| 卖家资料 singleflight | `seller_profile_cache.py:44-63` | 同一 seller 并发请求只加载一次 |
| 图片用完即删 | `item_analysis_dispatcher.py:143-144` | 避免磁盘无限增长 |
| WAL + busy_timeout | `sqlite_connection.py:107-111` | 读写不互斥，跨进程并发安全 |
| 索引按查询形态建 | `sqlite_connection.py:104-127` | `(result_filename, is_recommended, analysis_source, crawl_time)` 正好覆盖推荐筛选 |
| AI 日志 1 天保留 | `ai_handler.py:344` | `cleanup_ai_logs(keep_days=1)` |
| 任务日志 7 天保留 | `settings.py:101-106` | `task_log_retention_days=7` |

## 哪些「优化」其实没用

1. **加大 `max_pages`**：页数增加会线性增加时长，但新商品越来越少（去重后每页可能只有 1-2 个新的），边际收益递减。
2. **提高 AI 并发到 10**：抓取每 13.5 秒才产出一个商品，AI 并发 2 已经过剩。
3. **换更快的模型**：AI 时间占总时长 5% 以下。
4. **给 SQLite 加更多索引**：分页慢的原因是「全量取 + Python 过滤」，不是缺索引。
5. **把 Chromium 换成更轻的浏览器**：项目已经禁用 crashpad（`src/scraper.py:117-134`）省内存，但主要成本是浏览器本身。

真正有效的只有两个方向：

- **减少 sleep**：直接换账号存活率，不划算。
- **加结果缓存**：Dashboard 与分页的缓存是唯一无损优化。

## 容量估算

单机 4 核 8G，Docker 部署：

| 场景 | 可行任务数 | 依据 |
|---|---|---|
| 3 个任务 × 每 2 小时一次 | 可行 | 每任务约 16 分钟，错峰执行 |
| 10 个任务 × 每 30 分钟一次 | **不可行** | 10 × 16 = 160 分钟 > 30 分钟窗口，子进程会堆积 |
| 1 个任务 + 大量历史结果 | 需注意 Dashboard 变慢 | O(文件数 × 行数) |

**没有并发任务数上限保护**。`ProcessService.start_task` 只检查「同一 task_id 是否在跑」（`process_service.py:137-139`），不检查总进程数。如果 cron 设得比任务时长短，子进程会不断堆积，每个 200-400 MB。

这是我认为**最需要加的一道闸**：`推断：` 一个全局并发上限（比如 `MAX_CONCURRENT_TASKS=3`）+ 队列，比现在「来一个起一个」安全得多。

## 一句话记住

它的性能账本是「用 50 分钟的睡眠换一个不被封的账号」，而唯一真实的技术债是**结果查询与 Dashboard 的全量加载**——正确但会随数据量线性变慢。
