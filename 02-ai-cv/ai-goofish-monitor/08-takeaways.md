# 08 ·  takeaways：这个项目教了我什么

**这篇回答什么问题**：如果这个项目是我做的，我能从里面带走哪些可复用的工程手法？面试时怎么讲清楚？哪些地方看着好其实不能抄？

> 方法说明：本会话 delegation depth 为 0，subagent 不可调用；以下面试卡由主 Agent 按 RULES §6 结构自行模拟，非真实 subagent 输出。

## 一、9 条可迁移想法

### 1. 抓 API 响应，不抓 DOM

- **问题**：爬 SPA 时 DOM 结构三天两头变，选择器一改全挂。
- **做法**：用 `page.expect_response(lambda r: "/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/" in r.url)` 包住 `goto`，直接从 JSON 响应解析商品（`src/services/search_pagination.py:14`、`src/scraper.py:711-716`）。
- **为什么好**：数据结构比 DOM 稳定一个数量级；还顺手解决了"首屏响应可能早于监听器挂载"的竞态。
- **怎么用到我的项目**：任何内部 SPA 抓取，先开 DevTools 找 XHR，再写 `expect_response`；DOM 只用来点按钮。

### 2. 选择器用"前缀包含"，不用完整 hash

- **问题**：CSS Module 的类名带随机 hash（`FaZHsn8E`、`QAdOx8nD`），升级一次全变。
- **做法**：`[class*='areaWrap']`、`[class*='provItem']`、`[class*='searchBtn']`，只匹配语义前缀（`src/scraper.py:107-113`）。
- **为什么好**：把"易变的部分"从选择器里剔除；`tests/unit/test_scraper_region_filter.py` 专门断言"不能包含旧 hash"。
- **怎么用到我的项目**：第三方页面的自动化脚本，一律 `[class*=语义名]`，并把当前 hash 写进测试当"反向断言"。

### 3. 错误信息就是能力探测

- **问题**：不同 AI 网关对 `response_format`、`temperature`、Responses API 的支持参差不齐。
- **做法**：把上游报错文案做成特征串表（`UNSUPPORTED_JSON_OUTPUT_MARKERS` 等，`src/services/ai_request_compat.py:13-35`），命中就关掉对应参数重试；甚至兜底判 `status_code==404 and message=="error code: 404"`（`:178-195`）。
- **为什么好**：不依赖网关声明的"兼容 OpenAI"，用实际报错做运行时协商。四层降级（换 API 形态 → 关 json → 关 temperature → 降温度重试）让一个客户端适配所有模型。
- **怎么用到我的项目**：任何"标准协议 + 多家实现"的对接，先写错误特征表，再写降级状态机；别信文档。

### 4. 一个任务一个子进程

- **问题**：Playwright 抓取会崩、会卡死、会内存泄漏，跑在主进程里会拖垮整个 Web 服务。
- **做法**：`ProcessService` 用 `sys.executable -u spider_v2.py --task-name X` 起子进程，stdout/stderr 直接重定向到文件；停止时 `os.killpg(...SIGTERM)`，20 秒超时再 SIGKILL（`src/services/process_service.py:89-117`、`:254-279`）。
- **为什么好**：故障隔离 + 资源可回收 + 日志天然按任务切分。Web 进程只负责调度和展示，永远轻。
- **怎么用到我的项目**：凡是"不可信第三方库 + 长耗时"的活，扔子进程；主进程只留状态机和 HTTP。

### 5. 两级去重：内存 Set + 数据库唯一约束

- **问题**：翻页会重复返回同一商品，重启后又忘了内存里的 Set。
- **做法**：进程内 `processed_links` 用 `get_link_unique_key` 截断到第一个 `&`（`src/utils.py:105-119`），数据库层 `result_items` 加 `UNIQUE(result_filename, link_unique_key)`（`sqlite_connection.py:13-104`）。
- **为什么好**：内存层挡住同一次运行内的重复，数据库层挡住跨次运行与并发写的重复；两层都不贵。
- **怎么用到我的项目**：任何"抓取—落库"管道都这么配，别只做内存去重。

### 6. 熔断器会自己恢复

- **问题**：连续失败后继续重试只会把账号打死。
- **做法**：`FailureGuard` 连败 3 次写 `paused_until = now + 24h`，期间 `should_skip_start` 直接跳过；但检测到 cookie 文件 mtime 变新就自动解除（`src/failure_guard.py:155-357`、`:247-261`）。
- **为什么好**：既保护账号，又给"人已修复"留了自动恢复通道，不用手工删状态文件。
- **怎么用到我的项目**：熔断器一定要配一个"外部条件变化即恢复"的钩子，否则运维会被"为什么还不再试"逼疯。

### 7. SQLite 当唯一真相源 + 幂等迁移

- **问题**：从 `config.json` / `jsonl/` 迁移到数据库，老用户升级不能丢数据、不能重复导入。
- **做法**：`bootstrap_sqlite_storage` 在 `threading.Lock` 内建表，每个导入步骤用 `app_metadata` 的键（`bootstrap:legacy_tasks` 等）打标；表非空也直接标记完成（`sqlite_bootstrap.py:28-41`、`:57-73`）。
- **为什么好**：可重复启动、可中断续跑、不需要人工干预。单文件数据库对单机应用足够，省掉一个 PG。
- **怎么用到我的项目**：小系统别急着上 Postgres；SQLite + WAL + 幂等 bootstrap 能撑很久（`sqlite_connection.py:107-111`）。

### 8. 长耗时操作 job 化

- **问题**：AI 生成一套筛选标准要几十秒，同步 HTTP 会超时。
- **做法**：`POST /api/tasks/generate` 返回 `202 + job_id`，后台 `run_ai_generation_job` 跑五步并更新进度，前端轮询 `GET /api/tasks/generate-jobs/{job_id}`（`src/api/routes/tasks.py:87-139`、`task_generation_runner.py:72-118`）。
- **为什么好**：HTTP 层永远快；失败时能清理半成品（`task_generation_runner.py:116-117` 删掉不完整的 criteria 文件）。
- **怎么用到我的项目**：所有 >5 秒的写操作都该这么拆，哪怕只是内存里的 job 表。

### 9. 关键词规则作为 AI 的降级路径

- **问题**：AI 贵、慢、会挂；有些任务其实"标题含 XX 且价格低于 YY"就够了。
- **做法**：`decision_mode` 支持 `ai` / `keyword` 两种，keyword 模式走 `keyword_rule_engine.evaluate_keyword_rules`，纯 ASCII 关键词用词边界正则避免 `Q1` 命中 `Q1R5`（`src/keyword_rule_engine.py:65-109`）。
- **为什么好**：给用户一个"零成本、可预测"的选项；也是 AI 故障时的逃生通道。
- **怎么用到我的项目**：任何 AI 功能都配一条规则兜底，哪怕只是"包含关键词就放行"。

## 二、面试卡（7 题）

### Q1：这个项目解决什么问题？为什么值得做？

**30 秒答案**：闲鱼的商品搜索是"人找货"，但真正的痛点是"货找人"——用户想买 MacBook Air M1，不可能每小时刷一次。这个项目用 Playwright 模拟手机端搜索，按 cron 定时跑，抓到新商品后用多模态模型看图和描述判断值不值得买，值得就推到手机。核心价值不是爬虫，是"把人的重复筛选变成一条规则"。

**追问**：为什么不做成浏览器插件？——插件只在用户打开页面时工作，做不到 7×24 定时；而且拿不到稳定的登录态与代理轮换。

### Q2：为什么用子进程而不是 asyncio task？

**30 秒答案**：三个原因。第一，Playwright 同步 API 和 asyncio 事件循环容易互相卡；第二，浏览器崩溃、内存泄漏会污染主进程；第三，子进程可以整组杀掉（`os.setsid` + `killpg`），asyncio task 取消不掉底层 C 扩展。代价是进程间只能靠文件和数据库通信，状态同步有延迟——所以 `ProcessService` 用 `exit_watchers` 监听退出并回调生命周期钩子（`process_service.py:131`）。

**追问**：Windows 怎么办？——`:107` 的 `preexec_fn` 在 Windows 是 `None`，`:259-279` 退回 `process.terminate()`，杀不掉孙子进程。这是已知的平台差异。

### Q3：AI 调用怎么保证"换个模型也能跑"？

**30 秒答案**：不假设兼容，靠报错探测。请求先按 Chat Completions 发，命中"不支持 response_format"就关掉；命中"不支持 Responses"就切模式；温度不支持就去掉。所有特征串集中在 `ai_request_compat.py:13-35`，主流程 `ai_handler.py:446-468` 只负责按顺序试。响应侧 `ai_response_parser.py:12-44` 还兼容了 `reasoning_content` 这个非标准字段——智谱等网关会把答案放那里。

**追问**：这样不会有组合爆炸吗？——会，所以只做四层线性降级，不做全组合；宁可少支持一种网关，也不写 2^N 分支。

### Q4：反爬最关键的一招是什么？

**30 秒答案**：把浏览器伪装成一个真实的移动端用户，而不是"改 User-Agent"。`_default_context_options` 里 UA、viewport、DPR、`is_mobile`、`has_touch`、locale、timezone、geolocation 是一整套（`src/scraper.py:287-299`），`add_init_script` 再去掉 `navigator.webdriver`、伪造 `plugins`/`languages`/`chrome`（`:664-685`）。但这些都只是"入场券"，真正的关键是不触发行为风控：随机滚动、随机停留、每个商品后睡 5–10 秒（`:1167`）、翻页睡 10–15 秒（`:1198`）。

**追问**：遇到滑块怎么办？——代码只能检测弹窗并抛 `RiskControlError`（`:740-786`），不能自动过。设计上靠熔断 24h 等人工换号，不硬刚。

### Q5：性能瓶颈在哪？

**30 秒答案**：不在爬虫，在结果查询。`result_storage_service.py:114-147` 的 `_load_filtered_records_from_conn` 没有 SQL `LIMIT`，每次分页都把整张表 `SELECT` 出来、逐行 `json.loads`、再在 Python 里切片。结果集上千条时，翻到第 2 页和第 20 页成本一样。第二瓶颈是抓取本身——一个商品光固定延迟就 7–14 秒，50 个商品接近 10 分钟，这是反爬的必要成本，不该优化掉。

**追问**：怎么改？——把排序和分页下推到 SQL，`ORDER BY` 用上现有索引（`sqlite_connection.py:104-127` 已建了 `result_filename + publish_time/price` 复合索引），只在最终页取 `raw_json`。

### Q6：如果重做，你会改什么？

**30 秒答案**：三点。第一，`ai_handler.py` 和 `infrastructure/external/ai_client.py` 有两套几乎重复的降级逻辑，应该合并成一个 client。第二，`ProcessService` 只检查"同一 task 是否在跑"，没有全局并发上限（`process_service.py:134-145`），10 个任务同时到点会起 10 个 Chromium。第三，鉴权——`/auth/status` 明文比密码（`app.py:144-149`），`/api/*` 完全裸奔，这是最该补的。

**追问**：为什么不现在补？——因为它是单机自托管工具，默认只监听内网；但对多用户部署就是硬伤。

### Q7：这个项目的架构你打几分？

**30 秒答案**：分层清楚，但更多是目录分层，不是依赖倒置——`services` 直接 import `infrastructure` 的具体实现，换存储要改多处。优点是单机部署简单、没有过度抽象；缺点是测试要靠 `dependency_overrides` 手搓 fake（`tests/conftest.py:47-56`）。给 7 分：能跑能改，但不适合再长大。

**追问**：那什么规模该拆？——当出现第二个写入方（比如独立的采集 worker）时，SQLite 的单写锁就会顶不住，那时候再拆消息队列。

## 三、吹B一句话（4 条）

1. "一个 19k star 的闲鱼监控机器人，用一套'错误信息即能力探测'的降级链，把同一份代码跑在 OpenAI、ModelScope、智谱等一堆不兼容的网关上。"
2. "它把反爬做成状态机：登录失效、风控弹窗、单商品校验、连续失败各有不同的退出与恢复路径。"
3. "任务跑在独立子进程里，Web 服务只做调度和展示——浏览器崩一百次，后台页面照样能开。"

## 四、局限与不该抄的地方

| 局限 | 证据 | 判断 |
|---|---|---|
| `/api/*` 无鉴权 | 全仓无 `Depends(auth)`；`app.py:144-149` 仅明文比密码 | **绝对不要抄**。至少加中间件或反代 Basic Auth |
| 前端登录态存 localStorage 布尔位 | `web-ui/src/composables/useAuth.ts:6-60` | 可被手改绕过；服务端本来也没校验，属于"防君子" |
| 结果查询全量加载 | `result_storage_service.py:114-147` | 数据量小的时候没事，上万条会卡；抄思路别抄实现 |
| `ai_handler` 与 `ai_client` 逻辑重复 | `ai_handler.py:298-479` vs `ai_client.py:151-280` | 两套降级代码会漂移；抄一套就行 |
| 无全局并发上限 | `process_service.py:134-145` | 多任务同时触发会打爆内存；抄的时候加个 `asyncio.Semaphore` |
| 日志只按文件、无结构化字段 | `src/services/task_log_cleanup_service.py`、`logs/*.log` | 单机够用；告警得换 JSON 行日志 |
| CSS Module 前缀匹配依赖页面语义名 | `src/scraper.py:107-113` | 平台一改类名就失效；这是"抗 hash"不是"抗重构" |

**一句话记住**：这个项目最值钱的不是爬虫技巧，是"在不稳定的外部依赖面前，用降级、熔断、隔离把系统做成打不死的小强"——但它的安全模型是负数，抄架构可以，抄鉴权会出事。
