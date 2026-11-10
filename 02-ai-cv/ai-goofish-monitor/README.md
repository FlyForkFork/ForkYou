# ai-goofish-monitor（闲鱼智能监控机器人）

> 用 Playwright 驱动一个「像手机」的浏览器去闲鱼搜货，把每件商品连图带卖家资料丢给多模态大模型打分，合格就推送到手机。

| 项 | 值 |
|---|---|
| 上游 | [Usagi-org/ai-goofish-monitor](https://github.com/Usagi-org/ai-goofish-monitor) |
| 应用地址 | 自部署（默认 `http://127.0.0.1:8000`，无官方 SaaS） |
| License | MIT（`LICENSE`，Copyright (c) 2025 dingyufei615） |
| 语言 | Python（后端）+ TypeScript/Vue（前端） |
| 分析深度 | L2 |
| 分析 commit | `77f8d75869acd65f9dba72731b95c7c49ea67bdf` |
| 更新时间 | 2026-11-10 |

## 这套文档怎么读

| 文档 | 回答什么问题 | 什么时候读 |
|---|---|---|
| [01 定位](01-positioning.md) | 它是什么、替代了什么手工流程、和 5 个同类项目差在哪 | 第一次接触 |
| [02 架构](02-architecture.md) | 进程怎么分、数据怎么流、为什么抓取要跑在子进程里 | 想理解全局 |
| [03 代码走读](03-code-tour.md) | 先读哪 10 个文件、主链路怎么走 | 准备读代码 |
| [04 深挖：抓取-分析流水线](04-deep-dive-pipeline.md) | 反爬、限流、去重、熔断、账号轮换怎么拼起来 | 想偷爬虫工程化 |
| [04 深挖：多模型 AI 兼容层](04-deep-dive-ai-compat.md) | 一套代码怎么同时伺候 OpenAI / 网关 / 推理模型 | 要接多家模型 |
| [05 性能](05-performance.md) | 时间都花在哪、并发上限由什么决定 | 做容量判断 |
| [06 分支](06-branches.md) | 28 个分支哪些是历史快照、哪些不能合 | 想知道版本差异 |
| [07 贡献](07-contribute.md) | 怎么跑、怎么测、CI 做什么 | 想参与 |
| [08 收获](08-takeaways.md) | 9 条可迁移想法 + 面试卡 | 做分享/面试 |
| [09 运维](09-ops.md) | Docker 部署、SQLite 存储、常见故障 | 要落地 |

## 快速开始

```bash
git clone https://github.com/Usagi-org/ai-goofish-monitor && cd ai-goofish-monitor
cp .env.example .env    # 至少填 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL_NAME
docker compose up -d
# 浏览器打开 http://127.0.0.1:8000 ，默认账号 admin
```

登录态不是账号密码：用官方 Chrome 扩展从已登录的闲鱼页面导出 cookie JSON，粘进「闲鱼账号管理」（`chrome-extension/`，`src/api/routes/accounts.py:16`）。

## 一句话记住

它把「刷闲鱼捡漏」拆成三个可替换的部件——一个伪装成手机的浏览器、一套可自动生成的选品标准、一条能降级的多模型调用链——然后用子进程把它们隔离起来。
