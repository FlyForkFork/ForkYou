# ultime-space/skills · ForkYou 分析

> 一个仓库、三个自包含 AI skill 包：Codecraft（JS/TS 代码规范 + 零依赖 CLI）、Docscraft（文档治理）、Designcraft（设计知识）。各自 semver、各自 npm 包、互不 import。

| 项 | 值 |
|---|---|
| 上游 | [ultime-space/skills](https://github.com/ultime-space/skills) |
| 分析 commit | `624e48b6`（2026-11-10） |
| 档位 | default（6k–15k 中文字） |
| 规模 | 203 文件（codecraft 114 / designcraft 49 / docscraft 32 / 根 8），115 篇 Markdown |
| 版本 | Codecraft 2.0.2 · Docscraft 0.4.1 · Designcraft 0.11.0 |
| 许可 | 根目录无 LICENSE（GitHub 判 NOASSERTION）；三个 skill 各自 MIT |
| 图册 | [Guide](https://flyforkfork.github.io/ForkYou/06-web/ultime-space-skills/guide.html) |

## 一句话结论

值得学的是它的**治理骨架**——规则 ID、机检子集、coverage、ignore/baseline 分离、fail-closed 门禁、发布内容扫描、OIDC 发布；不是它那 21 条具体规则。项目极年轻（本地浅克隆可见 16 个 commit、1 位作者；上游历史可能更长），不适合当无脑依赖。

## 文档导航

| 文档 | 回答什么 |
|---|---|
| [01 定位](01-positioning.md) | 它在 agent skills 生态里占什么位置，和 vercel-labs / anthropics / superpowers 差在哪，值不值得学 |
| [02 架构](02-architecture.md) | 一个内容仓库 + 一个本地 CLI + 三条发布流水线怎么闭合，关键取舍与代价 |
| [03 代码走读](03-code-tour.md) | 从 `bin/codecraft.mjs` 到退出码的完整链路，先读哪 12 个文件，加规则/加 skill 改哪 |
| [04 深挖 · CLI](04-deep-dive-codecraft-cli.md) | 静态扫描、规则包、ignore/baseline、gates、SARIF 的设计与边界 |
| [04 深挖 · 打包](04-deep-dive-skill-packaging.md) | 自包含目录契约、三文件版本对齐、files 白名单、发布内容扫描、Trusted Publishing |
| [05 性能](05-performance.md) | 扫描成本模型与本机实测，A21 二次遍历的代价 |
| [07 贡献](07-contribute.md) | 环境、命令、CI 矩阵、发布流程、新手入口与坑 |
| [08 心得](08-takeaways.md) | 可迁移想法、面试卡、局限与不该抄的地方 |

跳过的文档与理由见 `meta.json` 的 `analysis.skipped`。

## 本仓库分析的三条硬事实

1. **本次最大变化是「发布内容扫描」**：三个 skill 各新增 `scripts/check-package-content.mjs`，用 `npm pack --dry-run --json` 拿真实打包清单再扫内容，把 AGENTS.md 的「子包不写内部材料」红线变成机器检查（`skills/codecraft/scripts/check-package-content.mjs:1-16`）。
2. **Designcraft 从「评审知识」扩成「决策框架」**：0.10.0 加结构方案库（S1–S16 + 五项代价），0.11.0 加类型倾向层（8 类型卡 × 10 角色卡）并把 Refine 改成四段诊断闸门（`skills/designcraft/docs/patterns.md:65-248`、`skills/designcraft/scenarios/refine.md:41-80`）。
3. **本地测试在 Windows 检出下会红 13 项**：findings 的 `file` 用 `path.relative` 产生 `\` 分隔，测试断言 `/`；仓库没有 `.gitattributes`。CI 只跑 ubuntu，所以从未暴露（实测见 05）。
