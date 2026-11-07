# 07 · 贡献：从改一行文档到发一个版本

> 这篇回答什么问题：想给这个仓库提 PR，需要什么环境、跑哪些命令、CI 会检查什么、发布怎么走、新手从哪切入、有哪些坑？

## 环境与工具链

| 项 | 要求 | 依据 |
|---|---|---|
| Node.js（skill 包 / CLI） | `>=20` | `skills/codecraft/package.json:59-61`（三个 skill 一致） |
| Node.js（`skills` CLI 安装） | `>=22.20` | `README.md:35`、`README.md:74` |
| 包管理 | npm；Codecraft 目录带 `pnpm-lock.yaml`，但脚本用 npm | `skills/codecraft/package.json:52-58` |
| 运行时依赖 | 零依赖（只用 Node 标准库） | `skills/codecraft/package.json` 无 `dependencies` |
| 系统权限 | 无特殊权限；`--changed/--since` 需要 git，gates 需要 shell | `skills/codecraft/src/cli.mjs:557-588`、`skills/codecraft/src/gates.mjs:204-249` |
| 网络 | CLI 不发起网络请求；安装/发布才用 npm | `skills/codecraft/README.md:470` |
| CI 运行器 | `ubuntu-latest` + Node 22 | `.github/workflows/ci.yml:8-55` |

## 本地命令（按 skill）

```bash
# Codecraft
cd skills/codecraft
npm test                     # 109 个 node:test 用例
npm run eval                 # 19 个 CLI fixture case
npm run self-check           # 用自家规则扫自家仓库
npm run release-check        # 版本三方对齐 + 必填文件
npm pack --dry-run           # 看发布内容

# Docscraft
cd skills/docscraft
npm test                     # 结构、版本、链接、路由、漂移类型
npm run release-check
npm pack --dry-run

# Designcraft
cd skills/designcraft
npm test                     # 结构、版本、链接、场景路径、纯知识约束
npm run release-check
npm pack --dry-run
```

仓库**没有配置 ESLint / Prettier / 类型检查脚本**；代码风格靠现有文件与 review 保持一致。这不是遗漏，是「零依赖」定位的一部分。

## CI 矩阵

`.github/workflows/ci.yml` 有三个并行 job：

| Job | 工作目录 | 步骤 |
|---|---|---|
| `test`（Codecraft） | `skills/codecraft` | `npm test` → `npm run eval` → `npm run self-check` → `npm pack --dry-run` |
| `docscraft` | `skills/docscraft` | `npm test` → `npm pack --dry-run` |
| `designcraft` | `skills/designcraft` | `npm test` → `npm run release-check` → `npm pack --dry-run` |

触发条件：push 到 `main`、所有 pull request（`.github/workflows/ci.yml:3-7`）。没有 macOS/Windows 矩阵，也没有 Node 20/22 双版本矩阵——这是可以改进的地方。

## 发布流程

1. 改 `VERSION`、`package.json.version`、`CHANGELOG.md` 三处，保持完全一致。
2. 本地跑 `npm test`、`npm run release-check`、`npm pack --dry-run`（Codecraft 还要 `npm run eval`、`npm run self-check`）。
3. 提交并 push `main`。
4. 打 tag 并推送：
   ```bash
   git tag codecraft-v2.0.0
   git push origin codecraft-v2.0.0
   ```
5. GitHub Actions 的 `publish.yml` 校验 tag 与版本一致、检查版本未发布、跑 test/eval、执行 `npm publish --access public --provenance`。
6. Docscraft / Designcraft 分别用 `docscraft-v*` / `designcraft-v*` 触发各自流水线。

发布不需要 npm token：OIDC Trusted Publishing 已在 npm 侧配置（`.github/workflows/publish.yml:9-11`、`skills/codecraft/README.md:438-450` 的版本与稳定承诺段落）。

## Issue / PR 规则

- 仓库**没有** `.github/ISSUE_TEMPLATE` 或 PR 模板；按 `CONTRIBUTING.md` 的约定走。
- 分支：从 `main` 切 `feat/<主题>` / `fix/<主题>`，完成后 `git rebase main`，主分支不保留中间提交（`skills/codecraft/CONTRIBUTING.md:7-12`）。
- 提交信息：`type(scope): subject`，正文写「为什么」。
- 规则改动必须同时更新：规则正文、`evals/golden-tasks.md`、相关测试；契约类改动整族刷新，不做零散小改（`skills/codecraft/CONTRIBUTING.md:18-24`）。
- 安全漏洞：不要公开贴密钥；按 `SECURITY.md` 走私密通道，或先开不含敏感信息的 Issue 说明「需要私下同步」。

## 3–5 个新手入口

1. **文档链接修复**：三个 skill 的 `structure.test.mjs` 都会检查相对链接；找一个断链并修，是最安全的第一个 PR。
2. **补 scenario**：给 Codecraft 增加一个真实场景（如「遗留 Vue 2 迁移评审」），按现有 `scenarios/*.md` 的结构写，不需要改代码。
3. **补 eval fixture**：在 `skills/codecraft/evals/fixtures/` 加一个最小违规样本，在 `cases.json` 加期望；这是理解 CLI 行为最快的方式。
4. **补 Designcraft 评审案例**：`docs/` 已有 13 篇，新增一个「组件库评审」模板或 golden task，成本低、价值直接。
5. **补 agent 适配说明**：目前只有 `adapters/generic/AGENTS.md`；可以为其他 agent 写「如何指向 SKILL.md」的说明，但不复制正文。

## 提交前检查清单

1. `npm test` 全绿；改了 CLI 行为必须补 `tests/` 用例。
2. `npm run eval` 全绿；新增/修改规则要补 fixture 与 `cases.json` 期望。
3. `npm run release-check` 通过；`VERSION` / `package.json` / `CHANGELOG.md` 三处一致。
4. `npm pack --dry-run` 里没有测试夹具、内部脚本或密钥。
5. 改了 SKILL.md 路由，就确认被引用的文件真实存在。
6. 提交信息用 `type(scope): subject`，正文写「为什么」，不要只写「update」。

维护者最在意的不是 PR 大小，而是「规则改动有没有同时改文档、测试、eval、README」；只改一处会被结构测试或 review 打回。小步 PR、每步可验证，比一次大改更容易合入。提交前把 `git diff` 自己读一遍，比等 reviewer 指出更省时间。这份清单也可以直接贴进 PR 模板。

## 贡献前必须知道的坑

- **SKILL.md 的路由路径必须真实存在**：结构测试会断言 `SKILL.md` 中引用的每个相对路径都能解析（`skills/codecraft/tests/structure.test.mjs:60-70`）；改文件名要同步改路由。
- **新增文件要进 `files[]`**：否则 `npm pack` 不含它；release-check 只检查必填目录，不检查你新加的子目录。
- **A21 不能 ignore**：配置校验会直接抛错（`skills/codecraft/src/ignore.mjs:25-29`）；发现密钥只能移除并轮换。
- **`audit` 默认不跑 gates**：2.0 起必须显式 `--run-gates`；改 CI 时漏了这个 flag，门禁会静默消失（`skills/codecraft/src/cli.mjs:278-282`）。
- **根 README 的目录树有笔误**：`README.md:93-96` 与实际结构不一致；改文档时别照抄。
- **测试 fixture 是故意违规的**：`evals/fixtures/**` 里有空 catch、明文密钥等样本；`self-check` 必须 `--exclude` 它们，否则自家检查会红。

> 一句话记住：**这个仓库的贡献门槛是「零依赖 + 三文件版本对齐 + 结构测试」，最安全的起点是修链接/补场景，最危险的改动是碰 A21 与发布配置。**
