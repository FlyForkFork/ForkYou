# 01 · 定位：它是什么，值不值得学

> 这篇回答什么问题：ultime-space/skills 在 2026 年的 agent skills 生态里占什么位置？它解决谁的痛点，和三个最常被拿来比较的项目差在哪，现在学它是不是好时机？

## 一句话是什么

**三个可安装、可独立发版的 AI 工作规范包**：Codecraft 管 JS/TS 代码与架构，Docscraft 管文档与 AI 上下文，Designcraft 管设计系统知识。每个 skill 都是一个自包含目录：`SKILL.md` 做入口，`docs/` 放正文，`scenarios/` 放任务剧本，`templates/` 放产出模板，`tests/` 与 `evals/` 做质量闸。

根 README 把边界写得很清楚：文档、适配器、脚本、版本都在 skill 自己的目录里，安装交给 `skills` CLI，仓库根只维护索引（`README.md:3`、`README.md:130-136`）。这不是一句口号：三个 `package.json` 各自声明版本与 `files` 白名单，Codecraft 还独立发布 npm 包并提供 `codecraft` 命令。

## 谁在什么场景下用它

- **AI 编程的重度用户**：每次开新会话都要重复「我们项目禁止 import 生成类型」「错误必须 Result 化」。Codecraft 把这些约束固化成 A1–A21 和审计契约，agent 先读 `SKILL.md` 再按任务路由到具体文档（`skills/codecraft/SKILL.md:55-67`）。
- **技术负责人 / 架构师**：要把「代码宪法」落到 CI，而不是只写一份 Wiki。Codecraft CLI 提供 `check`、`audit`、`plan`、`init` 四个命令，`--ci` 才阻断，`--changed` 只看变更（`skills/codecraft/src/cli.mjs:176-213`）。
- **写文档写到失控的团队**：Docscraft 用分层、单一真源、ADR、漂移检查治理 README/AGENTS/rules/docs，明确参考 Diátaxis、Write the Docs、K8s 文档指南等成熟机制，但只借结构不复制原文（`skills/docscraft/README.md:136-142`）。
- **设计系统维护者**：Designcraft 覆盖颜色、排版、空间与形状、布局、表面与光影、动效、状态、内容、构图、评审，给判据和取档建议，不做强制检查、不下阻断结论（`skills/designcraft/SKILL.md:1-12`）。

## 没有它之前，人们怎么做

三种常见替代：① 在 `AGENTS.md` / `CLAUDE.md` 里堆一大段规则；② 用 ESLint / Prettier / typecheck 管格式和类型，架构约束靠 code review 口口相传；③ 让 agent 每次临时读 README 和几篇内部文档。共同问题是：**规则没有稳定 ID，无法逐条验收；没有证据门槛，0 findings 会被误读成全部通过；文档与代码各自漂移**。Codecraft 的 `docs/shared/02-ai-contract.md` 直接要求审计输出「改了什么 / 为什么（A1–A21）/ 怎么验 / 风险 / 后续」，并把「0 findings」限定为「静态未命中」，不允许写成通过（`skills/codecraft/docs/shared/02-ai-contract.md:1-82`）。

## 竞品对比

| 方案 | 定位 | 核心差异 | License | 成熟度（2026-11-08） |
|---|---|---|---|---|
| **ultime-space/skills** | 代码 / 文档 / 设计三套规范内容包 | 规则 ID 宪法 + 自带 CLI + gates + baseline；面向 JS/TS，前端/后端分轨 | 根目录无 LICENSE（NOASSERTION），三个 skill 各自 MIT | 0 stars、1 fork；2026-10-26 创建；codecraft 共 15 个 tag，7 天内从 v1.0.2（2026-10-27）发到 v2.0.0（2026-11-03）；contributors=1 |
| **vercel-labs/skills** | agent skills 安装器与目录生态（`npx skills`） | 解决「装到哪个 agent、怎么更新」，支持 75+ agents；本身不提供代码规范内容 | MIT | 38,480 stars、3,355 forks（2026-11-08）；2026-01-14 创建；生态入口级 |
| **anthropics/skills** | Anthropic 官方 skill 示例库 + Agent Skills 规范 | 提供文档、创意、企业流程等参考实现，并维护 `spec/`；不是一套可执行的代码治理体系 | 仓库无统一 license；README 称许多 skill 为 Apache 2.0 | 188,570 stars、22,235 forks（2026-11-08）；2025-09-22 创建；事实标准来源 |
| **obra/superpowers** | agentic skills 框架 + 软件开发方法论 | 强调完整开发流程与技能编排，覆盖面比单一代码规范更宽 | MIT | 314,002 stars、27,931 forks（2026-11-08）；2025-10-09 创建；社区热度最高 |
| **手工 AGENTS.md + ESLint** | 团队自建约束 | 零依赖、完全可控；但没有统一规则 ID、审计契约、baseline 与跨项目复用 | 自有 | 成熟但不可复用；每团队重复造轮子 |

关键差异不是「谁功能多」，而是**分层**：vercel-labs 是分发层，anthropics 是标准与示例层，superpowers 是方法论层，ultime-space 是**垂直内容层**——把「代码规范」写成可安装、可版本化、可门禁化的 skill。它甚至直接复用 vercel-labs 的 `skills` CLI 做安装（`README.md:57-74`），不重复造安装器。

## 为什么是现在

1. **Agent Skills 已有事实标准**：`SKILL.md` + YAML frontmatter（`name` / `description`）成为跨 agent 的最小契约，anthropics/skills 与 agentskills.io 都在推同一套格式。
2. **安装层已经商品化**：`npx skills add` 把「复制到哪个目录」这件事标准化，内容作者可以专注写规则，不必维护 20 个 agent 的适配文件。
3. **AI 生成代码的瓶颈从「能不能写」变成「守不守约束」**：静态规则 + 项目门禁 + 审计证据链，比再写一段提示词更可持续。
4. **供应链工具成熟**：npm Trusted Publishing（OIDC）让个人项目也能零 token 发布并带 provenance，降低了「认真做版本」的成本。

## 项目健康度

- **Stars / forks**：0 / 1（GitHub API，2026-11-08）。热度很低，属于早期项目，不是「社区已验证」的选择。
- **发布节奏**：Codecraft 共 15 个 tag，从 `codecraft-v1.0.2`（2026-10-27）到 `codecraft-v2.0.0`（2026-11-03），间隔 7 天；Docscraft 8 个 tag，最新 0.4.0（2026-11-04）；Designcraft 4 个 tag，最新 0.9.1（2026-11-07）。tag 与 CHANGELOG 对齐，Codecraft 2.0.0 是破坏性变更（gate 配置 `run`→`entry`、`name`→`id`）。GitHub Releases 列表为空，发布以 tag + npm 为准。
- **贡献者**：1（UltimeLam，GitHub API 2026-11-08）。本地 clone 为浅克隆，只能看到一个可见 commit `a20cafa`。
- **Open issues**：0。
- **License**：GitHub 判定 NOASSERTION 是因为仓库根没有 LICENSE；`skills/codecraft/LICENSE`、`skills/docscraft/LICENSE`、`skills/designcraft/LICENSE` 均为 MIT，三个 `package.json` 的 `license` 也都是 MIT。**用之前要按目录确认，不要按根仓库判断。**
- **最近 commit**：2026-11-07，README 补 Designcraft 安装与发布入口。

## 地址与入口

- 仓库：https://github.com/ultime-space/skills
- 安装：`npx skills add ultime-space/skills --skill codecraft`（或 `--skill='*'`）
- npm：https://www.npmjs.com/package/@ultime/codecraft 、https://www.npmjs.com/package/@ultime/docscraft 、https://www.npmjs.com/package/@ultime/designcraft
- 文档入口：各 skill 的 `SKILL.md`；Codecraft 另有 476 行 README 覆盖 CLI 全参数与升级指南（`skills/codecraft/README.md:1-476`）

## 结论

**值得学，但要带着过滤器学。** 它的规则体系、CLI 的 fail-closed 设计、baseline 棘轮、Trusted Publishing 流水线，都是可以直接迁移到自家项目的工程经验；但项目本身很年轻、热度低、根许可不统一，不适合作为「无脑依赖」的生产基础设施。最适合：想给团队搭 AI 编码规范、又不想从零写一套治理工具的技术负责人。

**外部来源**
1. ultime-space/skills 仓库与 GitHub API：https://github.com/ultime-space/skills（2026-11-08）
2. npm @ultime/codecraft 包页：https://www.npmjs.com/package/@ultime/codecraft（2026-11-08）
3. vercel-labs/skills：https://github.com/vercel-labs/skills（2026-11-08）
4. anthropics/skills：https://github.com/anthropics/skills（2026-11-08）
5. obra/superpowers：https://github.com/obra/superpowers（2026-11-08）

> 一句话记住：**它是「规范内容 + 执行工具 + 发布证据」三合一的自包含 skill 集合，学它的治理骨架，别把早期项目当成熟基础设施。**
