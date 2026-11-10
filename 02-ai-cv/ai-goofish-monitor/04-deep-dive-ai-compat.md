# 04 深挖：一套代码伺候所有 OpenAI 兼容模型

## 这篇回答什么问题

- 「OpenAI 兼容」这四个字在现实里到底有多少种不兼容？
- 一次请求失败时，怎么判断是「该重试」还是「该换参数」还是「该换接口形态」？
- 为什么这个项目同时存在两套 AI 调用代码（`ai_handler.py` 与 `ai_client.py`）。
- AI 生成「选品标准」为什么要单独做成异步 job，还专门处理思考模型截断。
- 这套兼容层能不能直接搬到我的项目。

## 问题是什么

项目要让用户填三个环境变量就能接任意模型：

```
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api-inference.modelscope.cn/v1/
OPENAI_MODEL_NAME=XiaomiMiMo/MiMo-V2-Flash
```

（`.env.example` 默认值就是 ModelScope 的推理端点，不是官方 OpenAI。）

但「OpenAI 兼容」只保证路径长得像 `/v1/chat/completions`，不保证：

| 不兼容点 | 现实表现 |
|---|---|
| 只实现了 Responses API，没实现 Chat Completions（或反之） | 404，且错误信息可能是 `404 page not found` 或 `error code: 404` |
| 不支持 `response_format={"type":"json_object"}` | 400 `json_object is not supported by this model` |
| 不支持 `temperature` | 400 `temperature is not supported` |
| 把正文放在 `reasoning_content` 而不是 `content` | 200，但 content 为空 |
| 正文外面包 ```json 围栏 | 200，`json.loads` 直接抛 |
| 思考模型把 token 全用在推理上 | 200，但正文被截断 |

## 朴素做法为什么不够

最常见的写法是「try/except + 重试 3 次」：

```python
for i in range(3):
    try: return call()
    except: continue
```

对上面 6 种情况全部无效——**参数不支持不是瞬时故障，重试一万次也一样**。必须**修改请求本身**再试。

另一种写法是「为每家供应商写一个 adapter」。这在只有 3 家时可行，有 20 家网关时是灾难。

## 这个项目怎么做

### 核心思路：错误信息即能力探测

`src/services/ai_request_compat.py:13-35` 定义了四组特征串：

```python
UNSUPPORTED_JSON_OUTPUT_MARKERS = (
    "not supported by this model", "json_object", "json_schema",
    "text.format", "response_format.type",
)
RESPONSES_API_UNSUPPORTED_MARKERS = (
    "404 page not found", "page not found", "/responses", "/v1/responses",
)
CHAT_COMPLETIONS_API_UNSUPPORTED_MARKERS = (
    "404 page not found", "page not found", "/chat/completions", "/v1/chat/completions",
)
UNSUPPORTED_TEMPERATURE_MARKERS = ("temperature", "sampling temperature")
```

判定函数在 `:178-195`：

```python
def _is_api_unsupported_error(error, markers):
    message = str(error).lower()
    if any(marker in message for marker in markers):
        return True
    status_code = getattr(error, "status_code", None)
    body = getattr(error, "body", None)
    response = getattr(error, "response", None)
    response_text = getattr(response, "text", None) if response else None
    return (status_code == 404
            and message.strip() == "error code: 404"
            and not body and not response_text)
```

最后那个分支是「兜底中的兜底」：某家网关对不存在的路径只返回 `error code: 404`，既没有 `/responses` 字样也没有 body。**只能靠「404 + 无 body + 无 response.text」这三条件联合判定**。

### 降级阶梯：一个 for 循环里的四层状态机

`src/ai_handler.py:372-479` 的重试循环维护四个可变状态：

| 状态 | 初值 | 触发翻转的错误 | 翻转后行为 |
|---|---|---|---|
| `api_mode` | `chat_completions` | 不支持 Chat → 切 `responses`；不支持 Responses → 切回 | 改变请求结构 |
| `use_response_format` | `ENABLE_RESPONSE_FORMAT`（默认 true） | JSON 输出不支持 | 移除 `text.format` / `response_format` |
| `use_temperature` | `True` | temperature 不支持 | 移除 `temperature` 字段 |
| `current_temperature` | 0.1 | 每次重试 | 降到 0.05（`:379`） |

关键代码（`:446-468`）：

```python
if api_mode == CHAT_COMPLETIONS_API_MODE and is_chat_completions_api_unsupported_error(e):
    api_mode = RESPONSES_API_MODE
elif api_mode == RESPONSES_API_MODE and is_responses_api_unsupported_error(e):
    api_mode = CHAT_COMPLETIONS_API_MODE
if use_response_format and is_json_output_unsupported_error(e):
    use_response_format = False
if use_temperature and is_temperature_unsupported_error(e):
    use_temperature = False
```

注意它是 `if` 不是 `elif`——**一次失败可能同时翻两个开关**。比如某网关返回 400 且消息里同时提到 `json_object` 和 `temperature`，下一轮两个都关掉。

`max_retries = 4`（`:372`）。理论最坏情况：4 次都失败才放弃。

### 请求组装：同一个语义，两种形态

`build_ai_request_params`（`ai_request_compat.py:104-131`）：

| 语义 | Responses API | Chat Completions |
|---|---|---|
| 消息 | `input: [{role, content: [{type:"input_text", text}, {type:"input_image", image_url, detail}]}]` | `messages: [{role, content: [{type:"text"}, {type:"image_url"}]}]` |
| 输出上限 | `max_output_tokens` | `max_tokens` |
| 结构化输出 | `text.format` | `response_format` |

`:139-158` 的 `build_responses_input` 负责把 Chat 风格消息转成 Responses 风格；`:213-238` 的 `_coerce_content_item` 处理 `text`→`input_text`、`image_url`→`input_image` 的类型重命名。

**这一层是纯函数，无副作用，可以单测**——`tests/unit/test_ai_request_compat.py` 就是干这个的。

### 响应解析：三种形状 + 一个回退

`src/services/ai_response_parser.py:12-44`：

```python
if isinstance(response, (bytes, bytearray)): ...   # 直接是文本
if isinstance(response, str): ...
output_text = getattr(response, "output_text", None)   # Responses API
choices = getattr(response, "choices", None)           # Chat Completions
    content = getattr(message, "content", None)
    try: return _normalize_text_content(_coerce_content_parts(content))
    except EmptyAIResponseError:
        reasoning_content = getattr(message, "reasoning_content", None)   # 智谱等网关
        if reasoning_content: return ...
        raise
```

注释直接写了「智谱等 OpenAI 兼容网关在某些模式下会把输出放在 `reasoning_content` 而非 `content`」。这是**用真实故障换来的知识**。

JSON 提取更狠（`:47-53` + `:100-118`）：先剥 ``` 围栏，再 `json.loads`，失败则用 `JSONDecoder.raw_decode` 从每一个 `{` / `[` 位置试着解析，返回第一个合法的。

为什么要这么麻烦？因为模型经常输出：

```
好的，我来分析这个商品：
{"prompt_version": "EagleEye-V6.4", "is_recommended": true, ...}
希望这个分析对你有帮助。
```

前后都有废话。`raw_decode` 扫描是唯一稳妥的办法。

### 结构校验：不接受「差不多对」

`src/ai_handler.py:240-276` 的 `validate_ai_response_format` 硬性要求：

- `prompt_version`（用于追踪标准版本）
- `is_recommended` 必须是 `bool`，不是 `"true"`
- `reason`
- `risk_tags` 必须是 `list`
- `criteria_analysis` 里必须有 `seller_type`

校验不过就当作失败，重试。**这是把「模型输出」当「不可信输入」处理**——和校验 HTTP 请求体一个态度。

### 为什么有两套调用代码

| | `src/ai_handler.py:298-479` | `src/infrastructure/external/ai_client.py:151-280` |
|---|---|---|
| 运行在 | 抓取子进程 | Web 进程（prompt 生成） |
| 形态 | 模块级函数 + 全局 `client` | 类封装，可 `refresh()` 重载配置 |
| 返回 | 解析 + 校验后的 dict | 原始文本 |
| 图片 | 支持（base64 data URL） | 支持 |
| 日志 | 写 `logs/ai/<ts>.log` | 无 |
| 校验 | 有 `validate_ai_response_format` | 无（由调用方处理） |

`推断：` 这是渐进重构的中间态——先有 `ai_handler.py`（单文件时代），后拆出 `AIClient` 给 Web 进程用，但子进程那条路径没迁移。两边的降级逻辑是**复制**的（`ai_client.py:215-266` 与 `ai_handler.py:446-468` 几乎一致），改一处要记得改两处。

### 提示词生成：为什么必须异步 job

`src/prompt_utils.py` 干的事是「拿 MacBook 的选品标准当范例，让 AI 生成一份针对新商品的标准」。

难点在输出长度：`CRITERIA_MAX_OUTPUT_TOKENS = 8192`（`:39`），注释写明：

```
# 参考标准大约一千多 token。思考模型还会先输出推理，800 会把正文截掉。
```

这是 master 最后一个 commit（`77f8d75 fix: keep generated criteria from being cut off by reasoning`）修的问题。修复手法两层：

1. 输出上限从 800 提到 8192（`:39`）
2. 剥 `<think>` / `<thinking>` 块（`:40-44`），若剥完还剩未闭合标签，说明思考过程吃光了 token，直接报错（`:66-75`）：

```python
stripped = _THINK_BLOCK_RE.sub("", text).strip()
if _UNCLOSED_THINK_RE.search(stripped):
    raise RuntimeError("生成分析标准时，模型的思考过程占满了输出长度，正文被截断。"
                       "请换一个不输出长思考过程的模型，或提高模型服务允许的输出长度。")
```

**错误信息直接告诉用户怎么办**——这是好错误处理的样板。

因为生成要几十秒，接口设计成：

- `POST /api/tasks/generate` → 202 + `job_id`（`src/api/routes/tasks.py:87-129`）
- `GET /api/tasks/generate-jobs/{job_id}` → 轮询进度（`:130-139`）
- 后台 `run_ai_generation_job` 五步上报（`src/services/task_generation_runner.py:72-118`）：prepare → reference/prompt/llm → persist → task
- 失败时删掉半成品 criteria 文件（`:116-117`）

前端有配套的 `useTaskGenerationJob.ts` 和进度弹窗。

### 隐私上的一个小设计

`src/ai_handler.py:341-369` 每次请求写一条日志到 `logs/ai/<时间戳>.log`，但**只记元数据**：

```python
log_payload = {
    "timestamp": current_time, "task_name": ..., "product_id": ...,
    "title": ..., "image_count": len(image_data_urls),
}
```

不落完整 prompt（含商品 JSON 与卖家信息），也不落响应。配合 `cleanup_ai_logs(logs_dir, keep_days=1)` 只保留一天。

对比 `AI_DEBUG_MODE`（`src/config.py:47`）打开时才会 `safe_print` 完整内容到 stdout——**默认关闭，需要显式开启**。这是合理的默认值。

## 复杂度/性能/边界

| 维度 | 值 |
|---|---|
| 单次分析 token | 图片（按张）+ 商品 JSON（约 1-3k）+ 标准文本（约 1-2k）+ 输出上限 4000 |
| 最坏重试次数 | 4 次，每次都重新付费 |
| 单次失败成本 | 首次失败 + 3 次重试 = 4× 输入 token |
| 并发 | 由 dispatcher 的 Semaphore 控制，默认 2 |

边界条件：

- 图片读不到（文件被删）时 `encode_image_to_base64` 返回 None，该图被跳过，不影响请求（`ai_handler.py:326-330`）。
- `prompt_text` 为空直接返回 None，不发起请求（`ai_handler.py:308-310`）。
- `client` 未初始化（缺 `OPENAI_BASE_URL`/`OPENAI_MODEL_NAME`）直接跳过（`src/config.py:63-80`）。
- 响应格式校验失败会重试，4 次后抛 `ValueError`，被 dispatcher 捕获成 `_build_ai_error_result`（`item_analysis_dispatcher.py:136-142`），记录进结果但**不通知**。

## 取舍与局限

1. **错误特征串是硬编码的字符串匹配**。网关换一句错误文案就失效。没有「学习」机制。
2. **两套调用代码重复**。降级逻辑改一处漏一处是真实风险。
3. **降级状态不持久化**。每次分析都从 `chat_completions` 开始试，即使前面 100 次都证明了该端点只支持 `responses`。**每件商品都要多付一次失败请求**。这是最明显的可优化点。
4. **`max_retries=4` 时最坏 4 倍成本**，而第 2-4 次大概率是同样错误。
5. **`reasoning_content` 回退可能拿到思考过程而不是答案**。若某网关把思维链放 `reasoning_content`、正文放 `content`，而 `content` 是空字符串（不是 None），`_coerce_content_parts` 会返回 `""` 触发 `EmptyAIResponseError` 才回退——逻辑是对的，但依赖异常控制流，不够清晰。

## 我能偷什么

| 想法 | 怎么用到我的项目 |
|---|---|
| 错误信息当能力探测 | 接多家 LLM/存储/消息服务时，用「特征串 + 状态码 + body 是否为空」三元组判定，比维护 adapter 矩阵便宜 |
| 可变开关的降级循环 | 重试循环里维护 `use_x` 布尔量，失败时翻转，比递归/多函数清晰 |
| 一次失败翻多个开关 | 用连续 `if` 而非 `elif`，应对复合错误信息 |
| `raw_decode` 扫描 JSON | 任何解析 LLM 输出的地方，先剥围栏再扫描，不要指望模型只输出 JSON |
| 输出上限为思考模型翻倍 | 思考模型的 `max_tokens` 至少给 4-8k，否则正文必被推理吃光 |
| 剥 think 块 + 未闭合即报错 | 不要静默返回被截断的内容，直接报错并给出可操作建议 |
| 长任务 job 化 | 任何 >10 秒的 AI 调用都做成 202 + job_id + 轮询，别让 HTTP 连接挂着 |
| 元数据日志 + 短保留期 | 记录「谁在什么时候分析了什么」但不记内容，隐私与可排查性兼得 |

## 一句话记住

兼容层的本质是**把「模型供应商的方言差异」压缩成四个布尔开关和一个模式枚举**，用一次失败的请求换一次能力探测，然后用剩下的重试次数完成真正的调用。
