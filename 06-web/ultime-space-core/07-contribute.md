# 07 · 贡献：在 0.x 的生成器里改一个值

**这篇回答什么问题**：想给 `@ultime/core` 提 PR，需要什么工具链、跑哪些命令、改哪些文件、哪些坑不能踩。

## 工具链与系统要求

- **Node.js**：`>=22.18`（`package.json:70-72`）；CI 用 Node 22（`.github/workflows/ci.yml:22-24`）。
- **pnpm**：`packageManager: pnpm@12.6.0`（`package.json:73`）；CI 用 `pnpm/action-setup@v4` 固定 12.6.0（`.github/workflows/ci.yml:18-20`）。
- **OS**：纯 Node/TypeScript，无原生扩展；Linux/macOS/Windows 均可。CI 只在 `ubuntu-latest` 跑。
- **依赖**：`pnpm install --frozen-lockfile`；仓库自带 `pnpm-lock.yaml`，不要随意升级 lockfile。

## 本地构建、测试、检查

```bash
pnpm install --frozen-lockfile
pnpm check        # vp check + check-model.ts + build.ts --check
pnpm test         # vp test（7 个测试文件）
pnpm typecheck    # tsc --noEmit
pnpm build:tokens # 只重算 tokens.css / tokens.json / tokens.dtcg.json / kernel.json
pnpm build        # 产物 + dist 库出口
npm pack --dry-run
```

`pnpm check` 的三段分别在 `package.json:84`：格式/lint、静态守卫、产物同源。任何一段失败都不应提交。

## CI 矩阵与发布流程

CI（`.github/workflows/ci.yml`）：

- 触发：push 到 `main`、所有 PR；
- 权限：`contents: read`；
- 步骤：checkout → pnpm 12.6.0 → Node 22 → `pnpm install --frozen-lockfile` → `pnpm check` → `pnpm test`。

发布（`.github/workflows/publish.yml`）：

1. push tag `v*` 或手动触发；
2. 校验 tag 必须等于 `v` + `package.json.version`（`publish.yml:31-37`）；
3. 若该版本已在 npm 上，跳过发布、只做校验（`:39-47`）；
4. `npm publish --access public --provenance`，走 Trusted Publishing / OIDC（`permissions: id-token: write`，`:9-11`、`:58-62`）；
5. 发布后轮询 npm registry 最多 5 分钟确认可见（`:64-78`）。

注意 `prepublishOnly` 是 `pnpm check && pnpm test && pnpm build`（`package.json:89`），所以手动 `npm publish` 也会先跑全套检查。

## 测试怎么写

仓库用 Vitest（`vp test`），测试文件在 `tests/`，共 7 个、857 行。写测试时按“事实层”选文件，而不是按功能名：

- 改 `seed.ts` / `skeleton.ts` / `motion.ts` / `light.ts` / `color/**` → `tests/core.test.ts`，断言计数、公式、模式完整性；
- 改 `contracts.ts` → 仍在 `core.test.ts` 或新增合同断言；合同是纯函数，可以直接构造一个坏树验证 `pass: false`；
- 改 `exporters/**` / `tools/tokens.ts` → `tests/tools.test.ts`，断言平台过滤、字节数、`--check` 语义；
- 改 `tools/config.ts` / `semantics.ts` → `tests/tools-config.test.ts`；
- 改 `studio/**` → `tests/studio.test.ts`、`tests/selection.test.ts`、`tests/derivation.test.ts`；
- 改 CLI → `tests/cli.test.ts`。

一个实用原则：**测试应该断言“关系”而不是“快照”**。比如“第 5 档 radius 等于 4×base”“duration.3 等于 unit×3”“选择后 total 等于各类别之和”，这些断言在改 seed 后仍然成立；只断言“274 个 token”会在每次正常扩展时误报。

## 发布顺序与包依赖

`@ultime/core` 依赖 `@ultime/cli ^0.1.0` 与 `@ultime/studio ^0.1.0`（`package.json` 的 `dependencies`），所以发布顺序必须是 **cli / studio 先发，core 后发**；否则 core 的 `npm publish` 会拉不到新依赖。当前仓库只包含 core，另外两个包不在这个 clone 里，发布协调需要看组织级流程（待查实：本仓库没有 workspace 配置）。

`publish.yml` 的 tag 校验是硬门禁：tag 必须等于 `v` + `package.json.version`，否则直接失败（`.github/workflows/publish.yml:31-37`）。发布后脚本会轮询 npm registry 最多 5 分钟（`:64-78`），这是为了让“tag 已推、npm 还没可见”的窗口有一个确定的失败点。

## PR 提交前检查清单

1. `pnpm install --frozen-lockfile` 通过，没有改 `pnpm-lock.yaml`；
2. `pnpm check` 三段全绿（格式/lint、`check-model.ts`、`build.ts --check`）；
3. `pnpm test` 7 个文件全绿；
4. `pnpm typecheck` 无错；
5. 如果改了 `src/model/**` 或 `theme.example.json`，`pnpm build:tokens` 已重跑，四份产物同批 staged；
6. 如果改了合同/档位/出口，`README.md`、`CHANGELOG.md`、`AGENTS.md` 中受影响的部分已同步；
7. `npm pack --dry-run` 的 files 列表没有多带源码/测试/临时文件。

## 文档与 AI 文档同步

这个仓库把文档分成三层：`README.md` 给使用者（安装、出口、产物、边界），`DESIGN.md` 给设计决策（数值出处、为什么派生优先），`rules/*.md` + `AGENTS.md` 给贡献者与 AI（红线、验证命令、提交规则）。功能变更时三层的更新义务不同：

- 改公开 API / 产物 / 配置字段 → 必须改 `README.md` 对应章节；
- 改数值目标或派生策略 → 必须改 `DESIGN.md` 的出处说明；
- 改目录结构 / 红线 / 验证命令 → 必须改 `AGENTS.md` 与 `rules/README.md`；
- 只改内部实现、无行为变化 → 可以只写 `CHANGELOG.md`，并在 PR 说明“无功能性更新”。

`llms.txt` / `skills.md` / `agent.md` 是给 AI 工具的索引，不是营销材料；它们的准确性直接影响 agent 会不会从错误入口开始读。改公开出口时顺手检查这三个文件，比事后让 agent 猜要便宜。

## Issue / PR 规则

- 从 `main` 切 `feat/<主题>` 或 `fix/<主题>`；完成后 `git rebase main` 再合并，主分支不保留中间提交（`CONTRIBUTING.md:5-9`）。
- 一次提交一件事；提交信息用 `type(scope): subject`，正文写“为什么”。
- 项目接受 PR，但只有 1 位维护者（`git shortlog` 只有 UltimeLam）、0 个 open issue；没有 `good first issue` 标签可捡。**建议先开 issue 说明动机**，再提 PR。
- 安全报告不要公开贴密钥/客户数据；见 `SECURITY.md:5-15`。

## 3–5 个适合新手的入口

1. **补测试**：`tests/selection.test.ts` 和 `tests/derivation.test.ts` 是 0.7 新增的，覆盖选择/派生的边界最容易上手；也可给 `tests/core.test.ts` 加新的 seed 组合。
2. **补导出适配器**：`src/exporters/` 只有 CSS / JSON / DTCG 三个出口；新增一个 SCSS / Swift / Compose 出口不会碰模型，是理解“树 → 翻译”的最好入口。
3. **补中性配方**：`src/model/color/ramp.ts:50-71` 已有 `neutral / paper-night / same-warm / cool / sepia` 五个配方；加一个配方只需改 recipe 表 + 测试。
4. **补 CLI 诊断**：`src/cli/commands/inspect.ts` 只读输出产物/平台/模式/类别/合同/颜色/诊断；可以加“按合同 ID 过滤”“输出 markdown”等只读功能。
5. **补文档**：`README.md` / `AGENTS.md` / `rules/*.md` 对 AI 与人类都重要；文档改动不需要重算产物，但仍要过 `pnpm check` 的格式检查。

## 贡献前必须知道的坑

- **生成物不能手改**：`tokens.css` / `tokens.json` / `tokens.dtcg.json` / `kernel.json` 由 `pnpm build:tokens` 生成；改 `src/seed.ts` 或 `src/model/**` 后必须重跑并同批提交（`CONTRIBUTING.md:13`、`AGENTS.md` 红线）。
- **改合同要同批改模型**：`src/contracts.ts` 里有很多硬编码档数（如 `size-monotonic` 要求 5 档 8 步、`type-steps` 要求 9 档），改 `skeleton.ts` 的档位必须同步改合同，否则 `pnpm check` 会失败（`src/contracts.ts:174-218`）。
- **0.x 允许 Breaking**：minor 版本可含破坏性变更，但必须写进 README「版本与兼容」和 `CHANGELOG.md`（`CONTRIBUTING.md:27-30`）。
- **`tokens.json` 的 schemaVersion 仍是 4.0.0**：与内核 `6.0.0` 不一致（`src/exporters/json.ts:32`）；如果你要修版本一致性，这是一块明确的遗留，但要同时改测试和快照。
- **`--check` 对格式敏感**：产物逐字节比较，任何空格/换行差异都会 drift；不要用格式化工具重排生成物。
- **旧 seed 不迁移**：0.5.0 把 `lightTint` / `ambientTint` / `rimAlpha` / `bevel` 改名为 `lightColor` / `ambientColor` / `ambientAlpha` / `key`，不提供迁移器（`CHANGELOG.md:27-31`）；升级前先读 `kernel.json` 的 `schemaVersion/engineVersion`。

**一句话记住**：在这个仓库里，贡献不是“改一个 token”，而是“改 seed 或模型 → 重算四份产物 → 让合同、测试、文档一起过”；生成物和源永远同批提交。
