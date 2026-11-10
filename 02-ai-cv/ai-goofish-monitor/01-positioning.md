# 01 定位：它是什么、替代了谁的什么动作

## 这篇回答什么问题

- 这个项目到底在卖什么（不是「闲鱼爬虫」这么简单）。
- 没有它之前，想捡漏的人怎么做；它把哪一步自动化掉了。
- 同类项目 5 个，差异在哪。
- 19k star 是虚火还是有真实需求支撑。
- 值不值得学、适合谁学。

## 一句话是什么

一个自部署的「闲鱼选品机器人」：Playwright 驱动伪装成 Android 手机的 Chromium 去闲鱼搜索页抓商品，把商品 JSON + 图片喂给多模态大模型，由模型按一份可自动生成的「选品标准」判定是否推荐，推荐则推到 ntfy/Bark/Telegram 等渠道，全过程有 Web UI 管理（`src/app.py:98-114`）。

它的产品形态更接近「个人版闲鱼比价 + 选品助手」，不是爬虫框架。

## 谁在什么场景下用它

| 用户 | 场景 | 依赖的项目能力 |
|---|---|---|
| 二手数码捡漏者 | 盯「MacBook Air M1 32G 1T，5000 以内，个人卖家，九成新」 | 关键词+价格区间+区域筛选（`src/scraper.py:836-966`）、AI 判定成色与卖家画像（`prompts/base_prompt.txt:20-41`） |
| 小商家/回收商 | 多关键词并行盯盘、定时跑 | Cron 调度（`src/services/scheduler_service.py:52-76`）、多任务子进程并发（`src/services/process_service.py:89-117`） |
| 想学「LLM + 浏览器自动化」的人 | 拿它当工程样板 | 多模型兼容层（`src/services/ai_request_compat.py`）、AI 生成 prompt 的 job 化（`src/services/task_generation_runner.py:72-118`） |

## 没有它之前怎么做

1. **纯手工**：闲鱼 App 里搜关键词、按发布时间排序、一页页翻、点进详情看卖家评价和芝麻信用。捡漏本质是「信息刷新频率」竞赛，人工一天翻几十次就到顶。
2. **半自动脚本**：直接请求 `mtop.taobao.idlemtopsearch.pc.search` 接口。项目里就留着这条路径的证据——`src/config.py:22-23` 定义了搜索与详情两个 API 模式串。这条路的死法是签名（`sign`）与风控参数频繁变、cookie 过期快、请求指纹一验就废。
3. **通用网页监控工具**（如 changedetection.io）：能盯「页面变了」，但不懂「这台机器值不值 5000」，也不懂「这个卖家像不像贩子」。

它填的空白是第 3 类：**把「值不值得买」的判断也交给模型**，而不是只做「有没有新链接」的提醒。

## 竞品对比

数据取自 GitHub API（2026-11-10 查询），star 数为查询时值。

| 方案 | 定位 | 核心差异 | License | 成熟度 |
|---|---|---|---|---|
| **ai-goofish-monitor**（本项目） | 闲鱼选品 + AI 判定 + Web UI | 唯一把「多模态模型看图 + 卖家画像」做进主链路的；19.2k star；有 Docker 镜像与 CI | MIT | 高：5 个 release（最新 2.5，2026-10-09），52 open issues，21 位贡献者 |
| [LinBlink/super-ai-goofish-monitor](https://github.com/LinBlink/super-ai-goofish-monitor) | 本项目下游分叉，做「深度进化」 | 直接继承本项目的抓取与 AI 链路再扩展；41 star | MIT | 低：2026-08 创建，一个月内停更 |
| [tristanwqy/GooFish-AIMonitor](https://github.com/tristanwqy/GooFish-AIMonitor) | 本地运行的监控控制台 | 强调「全本地不外传」，加了收藏降价/售罄提醒；43 star | MIT | 低：2026-06 创建，star 与 issue 都少 |
| [dgtlmoon/changedetection.io](https://github.com/dgtlmoon/changedetection.io) | 通用网页变更监控 | 通用、成熟、支持 CSS/XPath 选择器与通知，但**没有语义判断**；35.7k star | Apache-2.0 | 很高 |
| [ChaosTechDev/xianyu-hunter](https://github.com/ChaosTechDev/xianyu-hunter) | 低价提醒 + 行情日报 + 自动咨询 | 偏「运营助手」，有账号健康检测；16 star | MIT | 低 |

结论：**同类里它是唯一「AI 判定 + 完整 Web 后台 + Docker 交付」都齐的**，其余要么是它的下游分叉，要么只做阈值提醒。这也解释了 star 集中度——`xianyu monitor` 关键词搜索下，第 2 名只有 52 star（`voltwake/xianyu-monitor`）。

## 为什么是现在

三个条件同时成立才可能出现这个项目：

1. **多模态模型便宜到可以「每件商品都看图」**。`src/ai_handler.py:325-330` 把图片 base64 成 data URL 直接塞进请求，`max_output_tokens=4000`（`src/ai_handler.py:388`）——一次判定成本可忽略。2023 年做不到。
2. **OpenAI 兼容协议成了事实标准**。项目能靠 `OPENAI_BASE_URL` 一行切换模型供应商（`src/infrastructure/config/settings.py:41-148`），并写了 238 行的兼容层（`src/services/ai_request_compat.py`）兜各家网关的差异。
3. **Playwright 让「假装成一台手机」变成配置项**。移动端 UA、DPR 2.625、touch、上海 geolocation 全是 launch context 参数（`src/scraper.py:287-299`），不需要维护真机农场。

## 项目健康度（2026-11-10 查询）

| 指标 | 值 |
|---|---|
| Stars / Forks | 19,205 / 3,136 |
| Contributors | 21（主作者 dingyufei615 占 397 commits，claude[bot] 25） |
| Releases | 5（2.5 / 2.4 / 2.3 / 2.2 / v2.1，最新 2026-10-09） |
| Open issues | 52 |
| 创建时间 | 2025-07-16 |
| 最近 push | 2026-10-10 |
| License | MIT |
| 默认分支 | master |

一个信号值得注意：贡献者里排第二的是 `claude[bot]`（25 commits），且 `.github/workflows/claude.yml` 配置了 issue 里 @claude 就自动跑 agent。**这是个「AI 参与开发」的仓库**，读 commit 时要注意区分人写的和 agent 写的。

## 值不值得学

值得，但要挑着学：

- **值得偷**：抓取链路的抗变化设计（CSS Module hash 用前缀匹配）、失败熔断与账号轮换、多模型兼容的降级阶梯、AI 生成 prompt 的异步 job 化。
- **不值得偷**：认证（明文比较 + 前端 localStorage，见 04/09）、WebSocket 无鉴权广播。
- 适合读者：想做一个「LLM 落地的完整小产品」的后端工程师；想学爬虫工程化（不是爬虫技巧）的人。

## 一句话记住

它卖的不是「爬闲鱼」，是「把一份模糊的购买需求翻译成可执行、可调度、可自动降级的判定流水线」。
