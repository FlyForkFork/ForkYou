# ultime-space-skills

> 把「AI 该怎么做代码、写文档、做设计」写成可安装、可版本化、可自检的 skill 包，而不是散落在聊天记录里的提示词。

| 项 | 值 |
|---|---|
| 上游 | [ultime-space/skills](https://github.com/ultime-space/skills) |
| 分析 commit | `a20cafa2075327e3d6456fcbe4a4fada1bf26073`（2026-11-07） |
| 许可 | 根目录无 LICENSE，GitHub 判为 `NOASSERTION`；三个 skill 目录内各自 MIT |
| 规模 | 192 个文件；codecraft 112、designcraft 43、docscraft 30 |
| 版本 | Codecraft 2.0.0 / Docscraft 0.4.0 / Designcraft 0.9.1（独立 semver） |
| 形态 | 三个自包含 skill：规则文档 + 场景 + 模板 + 测试/evals；Codecraft 另带零依赖 CLI |

**它解决什么**：agent 每次会话都从零理解项目约束，结论随模型和提示词漂移。Codecraft 把 21 条代码不变量（A1–A21）做成固定入口、审计契约和可执行门禁；Docscraft 管文档分层与单一真源；Designcraft 把视觉判断变成可引用判据。三者互不 import，安装统一交给 `skills` CLI。

## 知识包导航

| 文档 | 回答 |
|---|---|
| [01-positioning.md](01-positioning.md) | 在 agent skills 生态里是什么位置，和 vercel-labs、Anthropic、superpowers 差在哪 |
| [02-architecture.md](02-architecture.md) | 集合层、三个 skill、安装/发布链路、运行时读取契约 |
| [03-code-tour.md](03-code-tour.md) | 目录树、先读文件、Codecraft CLI 主流程、改哪里 |
| [04-deep-dive-codecraft-cli.md](04-deep-dive-codecraft-cli.md) | `check/audit/plan/init`、规则包、ignore/baseline、gates、SARIF |
| [04-deep-dive-skill-packaging.md](04-deep-dive-skill-packaging.md) | 自包含目录契约、semver、npm files 白名单、Trusted Publishing、evals |
| [05-performance.md](05-performance.md) | CLI 扫描复杂度、文件遍历与规则匹配成本、skip/ignore 设计 |
| [06-branches.md](06-branches.md) | 单分支事实与发布 tag 的关系 |
| [07-contribute.md](07-contribute.md) | 本地命令、CI 矩阵、发布流程、新手入口 |
| [08-takeaways.md](08-takeaways.md) | 可迁移到自家项目的 8 条做法、面试卡、吹B句 |
| [09-ops.md](09-ops.md) | 三种安装方式、版本锁定、升级回滚、供应链安全 |

## 一句话结论

它不是「又一个 lint 工具」，而是把**规范正文、静态检查、项目门禁、AI 输出契约**打包成同一条证据链；最值得偷的是「规则 ID 宪法 + 可机检子集 + baseline 棘轮 + 发布证据」这套治理骨架。

## 验证

```bash
node ForkYou/_forkyou/scripts/forkyou.mjs validate --project ultime-space-skills
node _cache/tmp/audit-docs.mjs ForkYou/06-web/ultime-space-skills ultime-space-skills
```
