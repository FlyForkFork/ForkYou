# 04 深挖 · Skill 打包：自包含目录、独立 semver 与 Trusted Publishing

> 这篇回答什么问题：一个「skill」除了 SKILL.md 和几篇文档，还要满足什么条件才能被安装、被版本化、被审计、被安全发布？ultime-space/skills 用哪些机械约束保证三个 skill 不互相拖累？

## 问题是什么

Skill 的门槛看起来很低：一个文件夹 + 一个 `SKILL.md` 就能被 agent 读取。但一旦要**分发给外部用户**，问题立刻变成工程问题：装到哪个目录、版本怎么对齐、npm 包里带哪些文件、发布凭证怎么管、规则改了怎么证明没退化、三个 skill 能不能各自升级。这个仓库的答案是一套「目录契约 + 三文件版本对齐 + files 白名单 + tag 触发 OIDC 发布 + 结构/评估测试」的组合。

## 朴素做法为什么不够

- **仓库级统一版本**：改 Docscraft 也要给 Codecraft 升版，用户被迫升级无关包。
- **手动 `npm publish` + token**：token 泄露就是供应链事故；发布者本地环境也无法证明「包来自哪个 commit」。
- **`npm publish` 不带 `files`**：测试 fixture、故意违规的样例、内部脚本全被打进包，用户装到的是「开发仓库」。
- **只有 `SKILL.md`**：没有结构测试，路由表指向的 `docs/` 文件被删了也没人发现。
- **只有单元测试**：CLI 的退出码、findings 数、SARIF 输出这些「对外契约」没有端到端验证。

## 核心机制

### 1. 自包含目录契约

每个 skill 的根目录都有同一组「必备件」：`SKILL.md`、`README.md`、`VERSION`、`CHANGELOG.md`、`LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、`package.json`，以及 `docs/`、`scenarios/`、`prompts/`、`templates/`、`tests/`、`evals/`。Codecraft 额外有 `bin/`、`src/`、`scripts/`、`adapters/` 与 `codecraft.config.example.json`；Docscraft / Designcraft 没有 CLI。

这个契约不是 README 约定，而是测试断言：Docscraft 和 Designcraft 的 `structure.test.mjs` 都有 `required files exist` 用例；Codecraft 的 release-check 也把 `SKILL.md/VERSION/CHANGELOG.md` 与 `docs/scenarios/prompts/templates` 列为必填并检查是否在 `files[]` 中（`skills/codecraft/scripts/release-check.mjs:35-47`）。

### 2. SKILL.md 只放最小元数据

三个 SKILL.md 的 frontmatter 都只有 `name` 和 `description` 两个字段，description 写清「做什么 / 什么时候用 / 不做什么」，正文是范围表、目录表、任务路由、模式、禁止清单。没有 `version`、没有 `license`、没有工具配置——这些都在 `package.json` / `VERSION` / `LICENSE` 里，避免第二份真源。

Codecraft 的 SKILL.md 结尾直接写「规则正文只在 `docs/`；本文件只做入口」（`skills/codecraft/SKILL.md:98`）。结构测试会扫描 SKILL.md 中出现的所有相对路径，确认文件真实存在（`skills/codecraft/tests/structure.test.mjs:60-70`），并检查每个 `docs/**/*.md` 都能从 SKILL.md 到达（`skills/codecraft/tests/structure.test.mjs:83-90`）。

### 3. 独立 semver：三文件必须对齐

每个 skill 用 `VERSION` 文件作为版本真源，`package.json.version` 必须与它一致，`CHANGELOG.md` 必须有当前版本的二级标题。Codecraft 的 `release-check.mjs` 把这条写成硬检查：

- `VERSION` 必须匹配 `^\d+\.\d+\.\d+$`；
- `package.json.version === VERSION`；
- `CHANGELOG.md` 有 `## <version>` 段；
- 不允许重复版本段；
- 不允许出现比当前版本更高的「未来版本」；
- 必填文件/目录必须存在且在 `package.json.files[]` 中。

（`skills/codecraft/scripts/release-check.mjs:19-47`；Docscraft / Designcraft 的同名脚本结构类似，只是必填文件列表略短。）

当前三个版本是 Codecraft 2.0.0、Docscraft 0.4.0、Designcraft 0.9.1；tag 分别有 15 / 8 / 4 个，互不绑定。这就是「独立 semver」的实际含义：**一个 skill 的破坏性变更不会强迫另外两个升 major**。

### 4. npm files 白名单：只发运行所需

Codecraft 的 `files` 白名单包含：`SKILL.md`、`README.md`、`bin`、`src`、`docs`、`scenarios`、`adapters`、`prompts`、`evals`、`templates`、`VERSION`、`CHANGELOG.md`、`LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、`codecraft.config.example.json`（`skills/codecraft/package.json:33-50`）。注意它**不包含** `tests/` 和 `scripts/`：测试夹具与发布检查脚本留在仓库，不进入用户安装包；`evals/` 则保留，因为它是可复现的 CLI 行为契约。

Docscraft 与 Designcraft 的 `files` 更短：`SKILL.md`、`README.md`、`docs`、`scenarios`、`prompts`、`templates`、`evals`、`VERSION`、`CHANGELOG.md`、`LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`（`skills/docscraft/package.json:27-40`、`skills/designcraft/package.json:30-43`）。它们没有 `bin/src`，因为不需要可执行文件。

### 5. tag 触发 + Trusted Publishing

发布不是「维护者本地 npm publish」，而是「push tag → GitHub Actions → OIDC → npm」：

```text
git tag codecraft-v2.0.0
git push origin codecraft-v2.0.0
```

`.github/workflows/publish.yml` 监听 `codecraft-v*` tag，权限只要 `contents: read` + `id-token: write`，先 `npm install -g npm@11`，再校验 tag 与 `package.json.version` 完全一致，然后用 `npm view` 检查该版本未发布，跑 `npm test` 与 `npm run eval`，最后 `npm publish --access public --provenance`（`.github/workflows/publish.yml:3-51`）。Docscraft / Designcraft 各有一条同构流水线，只是 tag 前缀和目录不同。

Trusted Publishing 的关键收益：**不需要在仓库里存 npm token**；npm 侧通过 OIDC 识别「这是 ultime-space/skills 的 publish.yml 在跑」，并生成 provenance attestation。npm registry 上 2.0.0 / 0.4.0 / 0.9.1 的 `_npmUser` 都是 `GitHub Actions`，且带 SLSA provenance（2026-11-08 查询）。

### 6. evals / golden tasks：行为契约的质量闸

- **Codecraft**：`evals/cases.json` 有 19 个 case，覆盖 A17 默认/边界、A6 空 catch/ Promise catch、ignore 生效/过期、library A11、0 文件、生成头、A21 明文/占位符/文档路径、A2 workspace/已声明、A6 干净、SARIF 等。`evals/run.mjs` 用 `spawnSync` 跑 `bin/codecraft.mjs`，逐项断言 exit code、各规则 findings 数、ignored/expired、warnings、coverage、SARIF 的 `ruleId`（`skills/codecraft/evals/run.mjs:1-86`）。
- **Docscraft / Designcraft**：只有 `evals/golden-tasks.md`，是人工回归清单，没有自动 runner。这是实际的成熟度差异，不是遗漏：两个内容型 skill 的「正确性」更多靠人读，Codecraft 因为有 CLI 才能做机器断言。

## 代码证据（8 处）

1. `skills/codecraft/SKILL.md:1-4`：frontmatter 只有 `name` 与 `description`，版本不进 SKILL.md。
2. `skills/codecraft/package.json:33-50`：`files` 白名单；`tests/`、`scripts/` 不发布。
3. `skills/codecraft/scripts/release-check.mjs:19-47`：VERSION / package / CHANGELOG 三方对齐 + 必填目录检查。
4. `.github/workflows/ci.yml:8-55`：三个 skill 并行 job，Codecraft 多跑 eval/self-check，Designcraft 多跑 release-check。
5. `.github/workflows/publish.yml:3-11`：tag 触发、最小权限、OIDC。
6. `.github/workflows/publish.yml:30-51`：tag=version 校验、重复版本检查、test/eval、`npm publish --provenance`。
7. `skills/codecraft/evals/run.mjs:1-86`：19 个 CLI case 的端到端断言逻辑。
8. `skills/docscraft/tests/structure.test.mjs:51-132`：frontmatter、版本一致、链接、路由、文档可达性、漂移类型覆盖。

## 复杂度与边界

- **版本对齐成本**：每个 skill 发版要改 `VERSION`、`package.json`、`CHANGELOG.md` 三个文件；release-check 把「忘记改」变成 CI 失败，成本从「线上事故」前移到「本地命令」。
- **包体成本**：Codecraft 2.0.0 的 npm 包 `fileCount=99`、`unpackedSize≈372KB`；Docscraft 0.4.0 为 27 文件 / ≈70KB；Designcraft 0.9.1 为 41 文件 / ≈178KB（npm registry，2026-11-08）。内容型 skill 的体积主要来自文档与模板，不是代码。
- **发布边界**：`skills` CLI 从 GitHub 仓库安装时跟随默认分支；要精确锁版本，走 npm + `skills-npm` 并在 `package.json` 固定版本（推断：`skills` CLI 是否支持按 tag/commit 安装待查实）。
- **质量边界**：Docscraft / Designcraft 的 evals 是人工清单，没有 CI runner；结构测试只能保证「文件在、链接通、版本对」，保证不了「内容判断正确」。

## 取舍与局限

1. **三份脚本重复**：三个 `release-check.mjs` 高度相似，没有抽公共包；换来每个 skill 完全自包含、可以单独拷贝出去。这是有意的重复。
2. **`files` 白名单要手工维护**：新增目录如果忘了加，npm 包里就没有；release-check 只检查必填目录，不检查「所有运行所需文件」。
3. **`evals` 进包但不跑**：用户拿到的 `evals/` 是行为说明与 fixture，不是自动执行的测试；真正的测试在 CI 的 `npm test`。
4. **根许可不统一**：三个 skill 各自 MIT，但根目录没有 LICENSE；GitHub 显示 NOASSERTION。对外分发时应以每个 skill 目录的 LICENSE 为准。
5. **Trusted Publishing 绑定仓库**：workflow 文件名、仓库、npm 包名要一起配置；迁移仓库或改 workflow 名会让发布失败，需要重新配置 trusted publisher。

## 我能偷什么

- **「VERSION + package.json + CHANGELOG」三方对齐 + release-check**：任何多包仓库都能用 50 行脚本消灭版本漂移。
- **tag 前缀按包区分**：`codecraft-v*` / `docscraft-v*` / `designcraft-v*`，一个仓库多条发布流水线，互不触发。
- **`files` 白名单 + `npm pack --dry-run`**：发布前先看包内容，比出事后再回滚便宜。
- **OIDC 发布 + provenance**：不存 token，且用户能验证「包从哪来」；个人项目也值得配。
- **结构测试**：断言 frontmatter、版本一致、相对链接可解析、路由路径存在——成本低，能挡住 80% 的「文档改坏了」。

> 一句话记住：**自包含不是「一个文件夹」，而是「目录契约 + 三文件版本对齐 + files 白名单 + tag/OIDC 发布 + 结构/评估测试」五件套共同保证的可分发单元。**
