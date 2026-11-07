# 07 · 贡献：从 clone 到 PR 的最短路径

> 结论先行：这是一个零第三方运行时依赖、pnpm + Node 22.18 的 TypeScript 仓库。贡献的核心纪律只有三条：**改 seed/模型必须重算产物、加 token 必须加合同与测试、方向守卫不能绕过**。命令都可以从 `package.json` 与 CI 反推，不需要额外工具链。

## 环境

- Node.js **>= 22.18**（`package.json` 的 engines）。
- pnpm **12.6.0**（`packageManager` 字段；CI 用同一版本，`.github/workflows/ci.yml:22-24`）。
- 无需数据库、浏览器或 API key；全部构建离线完成。

```bash
git clone https://github.com/ultime-space/core.git
cd core
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

`pnpm check` 已包含格式、lint、方向守卫与产物同源检查（`package.json` 的 scripts）；`pnpm test` 跑 5 个测试文件；`pnpm typecheck` 单独跑 `tsc --noEmit`，CI 没把它列进主闸，但本地建议跑。

## 常用命令

| 命令 | 作用 | 何时用 |
|---|---|---|
| `pnpm check` | `vp check` + `check-model.ts` + `build.ts --check` | 提交前必跑 |
| `pnpm test` | 5 个测试文件 | 改逻辑后必跑 |
| `pnpm typecheck` | `tsc --noEmit` | 改类型/签名后 |
| `pnpm build:tokens` | 生成四份产物 | 改 seed 或模型后 |
| `pnpm build` | `tsx scripts/build.ts && vp build` | 验证发布包 |
| `npm pack --dry-run` | 检查 npm 包内容 | 发布前 |

`pnpm build:tokens` 默认读 `theme.example.json`，也可以用 `--seed <path>` 指定别的 seed（`scripts/build.ts:30-31`）。`--check` 模式只比对不写盘，用于 CI 与 pre-commit。

## 工作流

1. **开分支**：从 `main` 切 `feat/<topic>` 或 `fix/<topic>`；仓库没有 develop 分支（见 06 篇）。
2. **一个主题一个提交**：`CONTRIBUTING.md` 明确要求；不要把格式化与功能混在一起。
3. **改代码**：模型改动放 `src/model/**`，出口改动放 `src/exporters/**`，守卫改动放 `scripts/check-model.ts`。
4. **补测试**：新增 token 必须补合同与回归；`rules/03-testing.md` 要求快照不能替代合同。
5. **重算产物**：跑 `pnpm build:tokens`，把 `tokens.css`、`tokens.json`、`tokens.dtcg.json`、`kernel.json` 与源码同提。
6. **本地验证**：`pnpm check && pnpm test && pnpm typecheck`。
7. **提 PR**：说明改了什么、为什么、怎么验；涉及合同变更要单独列出。

## 加一个 token 的检查清单

- [ ] `src/tree.ts` 的 `TokenType` 是否需要新类型。
- [ ] 模型里是否有派生函数；能不能从现有 seed 算出，而不是新增一份名单。
- [ ] `src/build.ts` 的树拼接是否挂上了新组。
- [ ] `src/contracts.ts` 是否加了对应合同（档位/派生关系/模式完整性）。
- [ ] `tests/core.test.ts` 是否有回归；默认合同必须仍然全过。
- [ ] `pnpm build:tokens` 后四份产物是否更新。
- [ ] `pnpm check` 是否通过（pre-commit 会再跑一遍）。

## 代码风格与边界

- **模型不带载体语法**：`src/model/**` 里不能出现 `px`/`rem`/`var()`/`color-mix`；这些只允许在 exporter 里（`AGENTS.md:22`）。
- **方向单向**：model 不得 import build/exporters/tools/studio/contracts/index；四类模型原则上互不 import（`scripts/check-model.ts:61-69`；单文件类别覆盖有限，见 04 篇）。
- **零第三方运行时依赖**：新增第三方 import 会被 `core-dependency` 守卫拒绝；零依赖是项目红线，`package.json` 的 dependencies 变化需人工确认。
- **语义不进 core**：role/语义表/布局/断点/交互反馈归上层（`AGENTS.md:20`）。

## 发布相关

- 包版本、schemaVersion、engineVersion 是三个独立版本号（`rules/04-release.md:9-15`）。
- 发布顺序：`@ultime/cli` → `@ultime/studio` → `@ultime/core`（`rules/04-release.md:21-23`）。
- GitHub Actions 的 publish 工作流由 `v*` tag 触发，要求 tag 与 `package.json` 的 version 一致；已发布的版本会跳过（`.github/workflows/publish.yml`）。
- 使用 npm Trusted Publishing（OIDC）与 `--provenance`，不需要长期 token。

## 常见失败

1. **产物过期 / 产物不一致**：改了 seed 或模型但没跑 `pnpm build:tokens`；重跑即可。
2. **`model-direction`**：model 里 import 了上层模块；可新建 `src/model/types.ts` 或把共享逻辑上移到 `src/tree.ts`。
3. **`category-isolation`**：color 里 import 了 light；通过 build 层传参，不要让模型互相调用。
4. **合同失败**：先看 `kernel.json` 的 `contracts.ids` 与失败行，再决定是修派生还是改目标；不要为了让测试过而放宽合同。

## PR 描述模板

建议按四段写，和仓库的「证据优先」文化一致：

```text
## 改了什么
一句话说明范围；涉及 token/合同就列出新增或变更的 ID。

## 为什么
是修 bug、补能力，还是调整设计目标？如果是合同变更，说明旧合同哪里不对。

## 怎么验
列出跑过的命令与结果：pnpm check、pnpm test、pnpm typecheck；如果改了产物，说明四份文件都重算。

## 风险
是否有破坏性变更（schemaVersion/engineVersion/公共入口）？是否需要同步 Studio 字段或文档？
```

## Review 时看什么

- **派生是否唯一**：新增的值能不能从 seed 算出来？如果写死了名单，先问为什么。
- **合同是否覆盖**：新 token 有没有对应合同？没有合同的 token 等于没有验收标准。
- **方向是否干净**：`pnpm check` 过了不代表 import 图一定对；review 时看新文件的 import 列表。
- **产物是否同源**：四份生成物是否与源码同批提交；`build.ts --check` 是否真的跑过。
- **文档是否同步**：新增 seed 旋钮要更新 `theme.example.json` 与 Studio 字段；新增出口要更新 09 篇的产物表。

## 结论

贡献门槛不高：环境两条命令、验证三条命令、纪律三句话。真正的门槛是理解「派生优先」——如果你发现自己要新增一份手写名单，先停下来想想能不能从 seed 算出来。
