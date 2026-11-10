# 01 · 定位：它是什么，值不值得学

> 这篇回答什么问题：ultime-space/skills 在 2026 年的 agent skills 生态里占什么位置？它解决谁的痛点，和三个最常被比较的项目差在哪，现在学它是不是好时机？

## 一句话是什么

**三个可安装、可独立发版的 AI 工作规范包**：Codecraft 管 JS/TS 代码与代码架构，Docscraft 管文档与 AI 上下文，Designcraft 管设计系统知识。每个 skill 是一个自包含目录：`SKILL.md` 做入口，`docs/` 放正文，`scenarios/` 放任务剧本，`templates/` 放产出模板，`tests/` 与 `evals/` 做质量闸。

根 README 把边界写死了：文档、适配器、脚本、版本都在 skill 自己目录里，安装交给 `skills` CLI，仓库根只维护索引（`README.md:3`、`README.md:127-133`）。这不是口号——三个 `package.json` 各自声明版本与 `files` 白名单，Codecraft 还独立发布 npm 包并提供 `codecraft` 命令（`skills/codecraft/package.json:1-40`）。

## 谁在什么场景下用它

- **AI 编程重度用户**：每次新会话都要重复「我们禁止 import 生成类型」「错误必须 Result 化」。Codecraft 把这些固化成 A1–A21 与审计契约，agent 先读 `SKILL.md` 再按任务路由（`skills/codecraft/SKILL.md:31-51`）。
- **技术负责人 / 架构师**：要把「代码宪法」落到 CI 而不是 Wiki。CLI 提供 `check/audit/plan/init`，`--ci` 才阻断，`--changed/--since` 只过滤报告（`skills/codecraft/src/cli.mjs:70-356`）。
- **文档写到失控的团队**：Docscraft 用分层、单一真源、ADR、漂移检查治理 README/AGENTS/rules/docs，把「文档类型」与「规则类型」拆成两组，防止混成一个桶（`skills/docscraft/SKILL.md:20-27`、`skills/docscraft/docs/rules/02-doc-types.md`）。
- **设计系统维护者**：Designcraft 覆盖颜色、排版、空间与形状、布局、表面与光影、动效、状态、内容、构图、结构方案、项目类型与页面角色、评审与风格，给判据和取档建议，不做强制检查（`skills/designcraft/SKILL.md:11-18`）。

## 没有它之前，人们怎么做

三种常见替代：① 在 `AGENTS.md` / `CLAUDE.md` 堆一大段规则；② 用 ESLint / Prettier / typecheck 管格式与类型，架构约束靠 code review 口口相传；③ 让 agent 每次临时读 README 和几篇内部文档。

共同问题：**规则没有稳定 ID，无法逐条验收；没有证据门槛，0 findings 会被误读成全部通过；文档与代码各自漂移**。Codecraft 的宪法把「机检现状」单独列成一节，明确写「已内置 A2/A6/A11/A17/A21，其余需项目门禁或人工」（`skills/codecraft/docs/shared/00-constitution.md:315-319`），这是它与「号称全自动」的工具最大的差别。

## 竞品对比

| 方案 | 定位 | 核心差异 | License | 成熟度（2026-11-10 GitHub API） |
|---|---|---|---|---|
| **ultime-space/skills** | 代码 / 文档 / 设计三套规范内容包 | 规则 ID 宪法 + 自带 CLI + gates + baseline + 发布内容扫描；面向 JS/TS，前端/后端分轨 | 根无 LICENSE（API `license: null`）；三个 skill 各自 MIT | 0 stars、1 fork、1 contributor（UltimeLam）；2026-10-26 创建；32 个 tag |
| **vercel-labs/skills** | agent skills 安装器与目录生态（`npx skills`） | 解决「装到哪个 agent、怎么更新」，本身不提供规范内容 | MIT | 38,828 stars、3,384 forks；2026-01-14 创建 |
| **anthropics/skills** | Anthropic 官方 skill 示例库 + Agent Skills 规范 | 提供参考实现并维护 `spec/`；不是可执行的代码治理体系 | API `license: null`（README 称多为 Apache 2.0） | 191,836 stars、22,540 forks；2025-09-22 创建 |
| **obra/superpowers** | agentic skills 框架 + 开发方法论 | 强调完整开发流程与技能编排，覆盖面比单一代码规范宽 | MIT | 315,455 stars、28,058 forks；2025-10-09 创建 |
| **手工 AGENTS.md + ESLint** | 团队自建约束 | 零依赖、完全可控；但没有统一规则 ID、审计契约、baseline 与跨项目复用 | 自有 | 成熟但不可复用 |

关键差异不是「谁功能多」，而是**分层**：vercel-labs 是分发层，anthropics 是标准与示例层，superpowers 是方法论层，ultime-space 是**垂直内容层**——把「代码规范」写成可安装、可版本化、可门禁化的 skill。它甚至直接复用 vercel-labs 的 `skills` CLI 做安装（`README.md:54-62`），不重复造安装器。

## 为什么是现在

1. **Agent Skills 已有事实标准**：`SKILL.md` + YAML frontmatter（`name` / `description`）成为跨 agent 的最小契约。三个 skill 的 frontmatter 都只有这两个字段，版本不进 SKILL.md（`skills/codecraft/SKILL.md:1-4`）。
2. **安装层已商品化**：`npx skills add` 把「复制到哪个目录」标准化，内容作者可以专注写规则。
3. **瓶颈从「能不能写」变成「守不守约束」**：静态规则 + 项目门禁 + 审计证据链，比再写一段提示词更可持续。
4. **供应链工具成熟**：npm Trusted Publishing（OIDC）+ `--provenance` 让个人项目也能零 token 发布（`.github/workflows/publish.yml:7-11`）。

## 项目健康度（2026-11-10）

- **Stars / forks / contributors**：0 / 1 / 1（UltimeLam，60 次贡献）。热度极低，属早期项目，不是「社区已验证」的选择。
- **发布节奏**：32 个 tag。Codecraft 17 个（`codecraft-v1.0.2` 到 `codecraft-v2.0.2`）、Docscraft 9 个（到 `docscraft-v0.4.1`）、Designcraft 6 个（到 `designcraft-v0.11.0`）。三个最新 tag 均为 2026-11-10。npm latest 已到 2.0.3 / 0.4.2 / 0.11.1（2026-11-10 查询），比本地 VERSION 领先一个 patch。Codecraft 2.0.0 是破坏性变更（gate 配置 `run`→`entry`、`name`→`id`）。
- **提交历史**：本地 clone 只有 16 个 commit（浅克隆，从 `a20cafa` 2026-11-07 起算）。上一次分析基线是 `a20cafa`，本次 HEAD `624e48b`，其间 50 文件 +2134/-129。
- **License**：GitHub 判 `null` 是因为仓库根没有 LICENSE 文件；`skills/*/LICENSE` 均为 MIT。**用之前按目录确认，不要按根仓库判断。**

## 地址与入口

- 仓库：https://github.com/ultime-space/skills
- 安装：`npx skills add ultime-space/skills --skill codecraft`（或 `--skill='*'`）
- npm：[`@ultime/codecraft`](https://www.npmjs.com/package/@ultime/codecraft)、[`@ultime/docscraft`](https://www.npmjs.com/package/@ultime/docscraft)、[`@ultime/designcraft`](https://www.npmjs.com/package/@ultime/designcraft)
- 文档入口：各 skill 的 `SKILL.md`；Codecraft 另有 476 行 README 覆盖 CLI 全参数与升级指南（`skills/codecraft/README.md:1-476`）

## 结论

**值得学，但要带着过滤器学。** 规则体系、CLI 的 fail-closed 设计、baseline 棘轮、发布内容扫描、OIDC 流水线，都是能直接迁移的工程经验；但项目极年轻、热度接近零、根许可不统一，不适合作为生产基础设施直接依赖。最适合：想给团队搭 AI 编码规范、又不想从零写治理工具的技术负责人。

> 一句话记住：**它是「规范内容 + 执行工具 + 发布证据」三合一的自包含 skill 集合，学它的治理骨架，别把 16 个 commit 的早期项目当成熟基础设施。**
