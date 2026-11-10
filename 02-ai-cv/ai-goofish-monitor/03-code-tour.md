# 03 代码走读：先读哪 10 个文件

## 这篇回答什么问题

- 仓库目录里哪些是噪音、哪些是主干。
- 从 `docker compose up` 到「第一件商品被推送」，代码是怎么一步步走到的。
- 想加功能该改哪几个文件。
- 测试在哪、怎么跑。

## 目录树（只列主干）

```text
ai-goofish-monitor/
├── src/
│   ├── app.py                  # FastAPI 入口 + 生命周期 + 认证 + SPA 托管
│   ├── scraper.py              # 抓取主流程（1344 行，子进程内跑）
│   ├── ai_handler.py           # AI 分析 + 图片下载 + 通知兼容层
│   ├── failure_guard.py        # 文件级熔断器
│   ├── rotation.py             # 账号/代理轮换池
│   ├── keyword_rule_engine.py  # 关键词判定（AI 的廉价替代）
│   ├── prompt_utils.py         # AI 生成选品标准
│   ├── parsers.py              # 闲鱼 API JSON → 领域字段
│   ├── config.py               # 模块级 .env 读取（有副作用）
│   ├── api/routes/             # 9 个 router
│   ├── services/               # 23 个服务模块
│   ├── domain/models/task.py   # Task / TaskCreate / TaskUpdate
│   └── infrastructure/         # SQLite / 配置 / AI 客户端 / 通知客户端
├── web-ui/                     # Vue 3 + Vite + TS，构建到 ../dist
├── chrome-extension/           # 导出登录态（manifest v3）
├── prompts/                    # base_prompt.txt + macbook_criteria.txt
├── tests/                      # 47 个文件，unit/integration/live 三层
├── spider_v2.py                # 子进程 CLI 入口
├── docker-compose.yaml         # 单服务 + 9 个挂载点
└── Dockerfile                  # 三阶段构建
```

噪音提醒：`doc` 分支里的 `web_server.py`(1194 行) 是已废弃的单文件版，master 上不存在；`static/*.png` 只是 README 截图。

## 构建/运行入口

| 入口 | 命令 | 代码位置 |
|---|---|---|
| Web 服务 | `python -m src.app` | `src/app.py:186-193` |
| 抓取子进程 | `python -u spider_v2.py --task-name X` | 由 `src/services/process_service.py:89-100` 拼出 |
| 前端开发 | `cd web-ui && npm run dev` | `web-ui/vite.config.ts:17-32`（代理 /api /auth /ws） |
| 前端构建 | `cd web-ui && npm run build` | 产物直出 `../dist`（`vite.config.ts:8-11`） |
| 测试 | `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest` | `pyproject.toml` |

## 主流程走读

### 阶段 1：Web 进程起来（`src/app.py`）

1. `:37-39` 三个全局单例：`ProcessService`、`SchedulerService(process_service)`、`TaskGenerationService`。
2. `:54-57` 把「任务启动/停止」的回调挂到 ProcessService 上——回调会写 SQLite 并广播 WebSocket（`:42-51`）。这是**唯一的跨进程状态回传机制**。
3. `:65-94` lifespan 启动序列，顺序很重要：
   - `bootstrap_sqlite_storage()` 建表 + 导入旧数据
   - `cleanup_task_logs(keep_days=...)` 清日志
   - 把所有任务的 `is_running` 重置为 False（因为重启后子进程都死了）
   - `scheduler_service.reload_jobs(tasks)` 再 `start()`
4. `:98-114` 注册 9 个 router。

### 阶段 2：触发一次任务

两条路殊途同归：

- 手动：`POST /api/tasks/start/{task_id}` → `src/api/routes/tasks.py:252-268`
- 定时：`SchedulerService._run_task` → `src/services/scheduler_service.py:78-81`

都进 `ProcessService.start_task(task_id, task_name)`（`src/services/process_service.py:134-163`）：

1. `_drain_finished_process(task_id)` 先回收残留
2. `failure_guard.should_skip_start(task_name, cookie_path=...)` — 熔断检查（`:140-145`）
3. `_open_log_file` 打开 `logs/<task>.log`
4. `_spawn_process` → `asyncio.create_subprocess_exec`（`:111-117`）
5. `_register_runtime` 登记进程 + 起 `_watch_process_exit` 监听（`:131`）
6. `_invoke_hook(self._on_started, task_id)` 触发阶段 1 的回调

### 阶段 3：子进程抓取（`spider_v2.py` → `src/scraper.py`）

`spider_v2.py:15-47` 解析参数；`:44-47` 默认从 `SqliteTaskRepository().find_all()` 取任务；`:99-120` 读 prompt 文件（`keyword` 模式跳过）。

进 `scrape_xianyu(task_config, debug_limit)`（`src/scraper.py:506`）：

1. `:512-528` 把 config dict 拆成局部变量（`decision_mode`、`keyword_rules`、`region_filter`…）
2. `:530-536` 生成本次 `run_id`，加载历史去重集合 `load_processed_link_keys(keyword)` 与价格快照 `load_price_snapshots(keyword)`
3. `:540-590` 组装账号池/代理池：`RotationPool` + `resolve_account_runtime_plan`（决定用根目录 `xianyu_state.json` 还是 `state/*.json` 池）
4. `:1279-1344` 外层重试循环：`attempt in range(1, attempt_limit+1)`，失败时按 `per_task`/`on_failure` 模式换号换代理
5. `:599-1230` `_run_scrape_attempt(state_file, proxy_server)` — 真正的抓取：

| 行号 | 做什么 |
|---|---|
| `:613-622` | 起 Chromium（`_resolve_browser_channel()` 决定 chromium/msedge/chrome） |
| `:628-645` | 若登录态是「增强快照」则覆盖 UA/locale/timezone/viewport/DPR/headers |
| `:650-660` | 构造 `ItemAnalysisDispatcher`，注入 5 个回调 |
| `:664-685` | `add_init_script` 抹掉 webdriver 痕迹 |
| `:690-702` | 先访问首页 + 随机滚动热身 |
| `:711-716` | `expect_response` 包住 goto，捕获搜索 API |
| `:717-720` | 被重定向到 passport → 抛 `LoginRequiredError` |
| `:740-786` | 检测 `div.baxia-dialog-mask` / `div.J_MIDDLEWARE_FRAME_WIDGET` → `RiskControlError` |
| `:796-834` | 点「新发布」「个人闲置」「包邮」 |
| `:836-936` | 省/市/区三级联动 + 提交 |
| `:938-966` | 价格区间填 input + 按 Tab |
| `:1000-1160` | 逐商品：开 detail page → 抓详情 API → `build_market_reference` → `dispatcher.submit()` |
| `:1198` | 翻页前 `random_sleep(10,15)` |
| `:1221-1223` | `finally` 里 `await analysis_dispatcher.join()` |

### 阶段 4：单商品分析（`ItemAnalysisDispatcher`）

`src/services/item_analysis_dispatcher.py:72-79` 的 `_process_job` 只有四步：

```python
record["卖家信息"] = await self._load_seller_info(job)      # 缓存 + 抓卖家主页
record["ai_analysis"] = await self._build_analysis_result(...)  # AI 或关键词
if await self._saver(record, job.keyword): self.completed_count += 1
await self._notify_if_recommended(item_data, record["ai_analysis"])
```

`_build_analysis_result`（`:93-98`）是三条分支：

- `decision_mode == "keyword"` → `evaluate_keyword_rules`（纯字符串匹配，零成本）
- `SKIP_AI_ANALYSIS` 全局开关 → 直接返回 `is_recommended=True`
- 否则 → `_run_ai_analysis`（`:124-146`），带 `finally` 删临时图片

### 阶段 5：AI 调用（`src/ai_handler.py:298-479`）

1. `:314` 把整个 `product_data` 序列化成 JSON 文本
2. `:325-330` 图片读成 base64 拼 data URL
3. `:332-337` `build_analysis_text_prompt` + `build_user_message_content` 拼消息
4. `:341-369` 写一条 `logs/ai/<ts>.log`（**只记元数据，不落 prompt 全文**——隐私考虑）
5. `:376-479` 重试循环，每轮根据错误降级（见 04 深挖）
6. `:240-276` `validate_ai_response_format` 校验必需字段：`prompt_version`、`is_recommended`、`reason`、`risk_tags`、`criteria_analysis.seller_type`

### 阶段 6：落库 + 通知

- 落库：`save_to_jsonl`（`src/utils.py:122-128`）名字是历史遗留，实际调 `save_result_record` 写 SQLite，`INSERT OR IGNORE`（`src/services/result_storage_service.py:154-196`）
- 通知：`send_ntfy_notification`（`src/ai_handler.py:280-297`）名字也是遗留，实际 `build_notification_service()` → 7 渠道并发

## 先读的 10 个文件（按顺序）

| # | 文件 | 为什么先读它 |
|---|---|---|
| 1 | `src/app.py` (193) | 全局单例、生命周期、认证、SPA 托管都在这里，10 分钟建立心智模型 |
| 2 | `src/services/process_service.py` (307) | 理解「任务 = 子进程」是读懂其余一切的前提 |
| 3 | `spider_v2.py` (120) | 子进程侧的最小入口，看清参数怎么传进来 |
| 4 | `src/scraper.py:506-720` | 只读开头 200 行，掌握浏览器启动与热身 |
| 5 | `src/scraper.py:796-966` | 筛选交互，学 CSS Module 前缀匹配的写法 |
| 6 | `src/services/item_analysis_dispatcher.py` (173) | 全文不长，是抓取与 AI 的接缝 |
| 7 | `src/ai_handler.py:298-479` | 多模型兼容的降级阶梯，最有迁移价值的一段 |
| 8 | `src/services/ai_request_compat.py` (238) | 与 7 配套，看错误特征串怎么维护 |
| 9 | `src/infrastructure/persistence/sqlite_connection.py` (182) | 表结构与索引，决定所有查询的形态 |
| 10 | `src/failure_guard.py` (357) | 文件级熔断 + 自动恢复，跨进程状态的好样本 |

## 关键签名

```python
# src/scraper.py:506
async def scrape_xianyu(task_config: dict, debug_limit: int = 0)

# src/services/item_analysis_dispatcher.py:46
def submit(self, job: ItemAnalysisJob) -> None
async def join(self) -> None

# src/services/item_analysis_dispatcher.py:19-30
@dataclass(frozen=True)
class ItemAnalysisJob:
    keyword: str; task_name: str; decision_mode: str; analyze_images: bool
    prompt_text: str; keyword_rules: tuple[str, ...]; final_record: dict
    seller_id: Optional[str]; zhima_credit_text: Optional[str]
    registration_duration_text: str

# src/ai_handler.py:298
async def get_ai_analysis(product_data, image_paths=None, prompt_text="")

# src/services/result_storage_service.py:150
async def save_result_record(record: dict, keyword: str) -> bool

# src/services/price_history_service.py:273
def build_item_price_context(snapshots, *, item_id, current_price, market_snapshots=None) -> dict

# src/failure_guard.py:155
class FailureGuard:  # should_skip_start / record_failure / record_success
```

## 想加功能改哪

| 需求 | 要改的文件 |
|---|---|
| 加一个通知渠道 | `infrastructure/external/notification_clients/` 新建 client + `factory.py:15-46` 注册 + `settings.py` 加字段 + `web-ui/src/views/SettingsView.vue` 加表单项 |
| 加一个筛选条件（如「只看有验货报告」） | `scraper.py` 筛选段（`:796-966`）+ `domain/models/task.py` 加字段 + `web-ui` 任务表单 |
| 换判定逻辑（如接自建分类器） | `item_analysis_dispatcher.py:93-98` 加分支 + 实现一个 `AIAnalyzer` 签名兼容的函数 |
| 改结果表结构 | `sqlite_connection.py:13-104` + 在 `_migrate_*` 加一次性迁移（参考 `:126-140`） |
| 加新 API | `src/api/routes/` 新建 router + `app.py:105-114` 注册 |
| 改选品标准模板 | `prompts/macbook_criteria.txt` + `prompt_utils.py:12-35` 的 META_PROMPT |

## 测试在哪、怎么跑

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest                      # 全量（README 推荐写法）
pytest tests/unit/test_ai_request_compat.py -v               # 单个文件
pytest -m live                                               # 真流量冒烟（需真凭据）
cd web-ui && npm run build                                   # 前端构建校验
```

| 层 | 数量 | 覆盖什么 |
|---|---|---|
| `tests/unit/` | 24 | AI 兼容、解析器、抓取片段（region/headers/browser channel）、熔断、价格、通知、env |
| `tests/integration/` | 6 | 4 个 API 路由 + CLI 参数 + 解析流水线 |
| `tests/live/` | 3 | 真实闲鱼流量的冒烟（默认跳过） |

值得注意的两个测试：

- `tests/test_frontend_build_paths.py` — 校验前端产物路径，防止 `dist/` 位置漂移
- `tests/unit/test_scraper_extra_headers.py` — 就是 02 里提到的「XHR 头套到文档请求导致白屏」那个坑的回归测试

注意 `tests/unit/` 覆盖的是纯函数与片段逻辑，不是端到端；`tests/integration/` 用 FastAPI `TestClient` + fake service（`tests/conftest.py:47-56`），不需要真浏览器。所以 `pytest` 默认秒级跑完，对 CI 很友好——可惜项目没把 pytest 放进 CI（见 [07 贡献](07-contribute.md)），这也正是仓库最该补的一环，没有之一。

## 30 分钟读完的路线

如果只有半小时，按下面四步走，不要从 `scraper.py` 第一行开始读：

1. **先看骨架（5 分钟）**：`src/app.py:65-114` 的 lifespan 与 router 注册，搞清楚「启动时做了什么、有哪九个入口」。这一步能建立"Web 进程只做调度"的第一印象。
2. **再看隔离（8 分钟）**：`src/services/process_service.py:89-163`，重点看 `_build_spawn_command`、`_spawn_process`、`start_task` 三段。理解"任务 = 一个子进程"之后，后面所有日志、退出码、kill 逻辑都顺了。
3. **然后是外部世界（12 分钟）**：`src/scraper.py:506-560`（入口与配置拆解）→ `:599-720`（起浏览器、进首页、拦截首个搜索响应）→ `:1010-1050`（遍历商品、取详情）。只看这三个窗口，中间的筛选项点击、地区选择先跳过。
4. **最后是接缝（5 分钟）**：`src/services/item_analysis_dispatcher.py:35-100`，看它如何把「抓到的商品」变成「AI 任务」再变成「落库 + 通知」，这是全仓最重要的一个接口。

跳过不读也不影响理解的文件：`src/config.py`（旧版模块级配置）、`src/api/routes/prompts.py`、`src/services/task_service.py`（45 行纯转发）、`web-ui/src/components/ui/`（shadcn-vue 生成的组件）。

## 一句话记住

读这个仓库的顺序是「app.py 看骨架 → process_service 看隔离 → scraper 看外部世界 → dispatcher 看接缝 → ai_handler 看降级」，其余 20 多个 service 都是这五处的配角。
