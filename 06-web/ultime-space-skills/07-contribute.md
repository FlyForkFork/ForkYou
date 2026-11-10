# 07 贡献：一个人维护的三个 npm 包，靠什么守住质量

> 这篇回答什么问题：想给 `ultime-space/skills` 提 PR，要过哪些关？维护者用什么机制保证「文档改了、测试没改」不会混过去？CI 和发布流水线分别负责什么？

## 贡献入口

这个仓库没有根级 `CONTRIBUTING.md`（截至分析 commit `624e48b`，`git ls-files` 只有三个包内各自的 `skills/*/CONTRIBUTING.md`）。根 README 的「贡献」一节直接链到 `skills/codecraft/CONTRIBUTING.md`（`README.md:176-178`）。另外根目录有 `AGENTS.md`，是给 AI 协作者的红线（`AGENTS.md:9-15`）。

三个包的贡献指南结构一致：工作流 → 改动规则 → 验证 → 版本。差异在「改什么必须同步改什么」：

- codecraft：规则改动必须同时更新规则正文、`evals/golden-tasks.md`、相关测试（`skills/codecraft/CONTRIBUTING.md:13-17`）。
- docscraft：文档结构改动必须同步 `SKILL.md` 路由表、测试与清单覆盖（`skills/docscraft/CONTRIBUTING.md:11-14`）。
- designcraft：再加一条「提炼不能新增知识库没有的规则」——需要新增时先补主题文档，再同步场景与测试（`skills/designcraft/CONTRIBUTING.md:11-16`）。

## 工作流：短分支、rebase、一次一件事

三份指南写的是同一套（`skills/codecraft/CONTRIBUTING.md:7-11`）：

1. 从 `main` 切 `feat/<主题>` 或 `fix/<主题>`；
2. 完成后 `git rebase main` 再合并，主分支不保留中间提交；
3. 一次提交只做一件事，提交信息用 `type(scope): subject`，正文写「为什么」。

这条「主分支不保留中间提交」的规则，和仓库的发布方式匹配：每个包独立发版，历史越干净，`CHANGELOG` 与 tag 的对应关系越好查。

## 改动规则：契约类改动整族刷新

三份指南都强调同一件事：**契约类改动整族刷新，不做零散小改**。codecraft 把「档位 / 命名 / 单位 / 角色」列为契约（`:17`）；docscraft 是「分层 / 类型 / 路由口径」（`skills/docscraft/CONTRIBUTING.md:14`）；designcraft 是「目标值 / 命名 / 评审分级 / 边界」（`skills/designcraft/CONTRIBUTING.md:14`）。

这背后的判断是：这些概念在 `SKILL.md` 路由、`docs/` 正文、`scenarios/` 剧本、`prompts/` 模板、测试里多处出现，只改一处会造成「入口说的和正文不一样」。`structure.test.mjs` 里的「路由表与 docs 可达性」测试就是这条规则的机检版（`skills/codecraft/tests/structure.test.mjs`）。

designcraft 还有一条特殊约束：`docs/patterns.md` 是经验方案，不是规则；新增条目只改它、`templates/option-set.md` 与 evals，不改判据、不新增档位（`skills/designcraft/CONTRIBUTING.md:16`）。这是防止「经验沉淀」悄悄变成「新规则」。

## 验证矩阵：五条命令，各有分工

以 codecraft 为例（`skills/codecraft/CONTRIBUTING.md:19-32`）：

| 命令 | 管什么 |
|---|---|
| `npm test` | 单测：check / cli / gates / baseline / ignore / plan / detect / structure / docs / release-content |
| `npm run eval` | 19 个 golden case，跑真实 CLI，验证 agent 行为 |
| `npm run self-check` | 用 design-system 规则扫自己，`--exclude "evals/fixtures/**"` |
| `npm run release-check` | 版本 / CHANGELOG / 打包清单 + 发布内容扫描 |
| `npm pack --dry-run` | 人工确认实际打包文件 |

指南还规定：「新增 / 修改规则必须补测试；没有反例的规则降级为参考」（`skills/codecraft/CONTRIBUTING.md:30`）。这条比「必须写测试」更具体——它要求规则本身带反例，否则无法验证它真的会命中。

designcraft 多一步「发布前自检」：独立代理回归，至少覆盖入口、列表、详情、官网各一个样本；只给 skill 文件与页面路径，不给口头解释，不读既有评测记录（`skills/designcraft/CONTRIBUTING.md:30-37`）。这是对「文档型 skill」的特殊验证——不能靠作者自己读一遍说「没问题」。

## CI：三个 job，Linux + Node 22

`.github/workflows/ci.yml` 在 push `main` 和所有 PR 上触发，三个 job 并行：

- **test**（codecraft）：`npm test` → `npm run eval` → `npm run self-check` → `npm pack --dry-run`（`ci.yml:9-24`）。
- **docscraft**：`npm test` → `npm pack --dry-run`（`:26-39`）。
- **designcraft**：`npm test` → `npm run release-check` → `npm pack --dry-run`（`:41-55`）。

三个 job 都是 `ubuntu-latest` + Node 22。这个选择很省事，也留下一个真实盲区：**CI 从不跑 Windows**。本地实测在 Windows 检出（`core.autocrlf=true`，仓库无 `.gitattributes`）时，codecraft 的 `npm test` 出现 14 个失败（转 LF 后仍 13 个），根因是 `path.relative` 返回反斜杠，而测试断言 `src/config.ts` 这类正斜杠路径。失败集中在 A17、A6、A21、`--exclude`、`--changed` 与 frontmatter 检查。这是**可移植性缺陷**，不是测试写错：JSON/SARIF 输出里的 `artifactLocation.uri` 在 Windows 上会带反斜杠，下游消费方可能解析失败。CI 只有 Ubuntu，所以从未暴露。

## 发布：tag 触发、版本查重、OIDC

发布不是一个 job，而是每个包一份 workflow：

- `publish.yml`（codecraft）：tag `codecraft-v*` 或手动触发；权限 `contents: read` + `id-token: write`；先校验 tag 与 `package.json.version` 一致（`publish.yml:30-33`），再 `npm view` 查重（`:35-41`），然后 `npm test`、`npm run eval`，最后 `npm publish --access public --provenance`（`:43-51`）。
- `publish-docscraft.yml` / `publish-designcraft.yml` 同构，只是 tag 前缀与包名不同。

两个值得注意的设计：

1. **发布前跑 eval，不只是 test**：单测过了但 agent 行为退化，仍然会被拦下。
2. **`--provenance` + OIDC**：不保存长期 npm token；发布身份由 GitHub Actions 提供，包上带可验证来源。workflow 注释明确写了「Requires npm Trusted Publishing configured for ultime-space/skills + publish.yml」（`publish.yml:49`）。

## 版本策略：semver，不按「感觉重要」

三个包的 semver 定义一致：

- **major**：破坏性变更——规则 ID 语义变更、配置格式不兼容、JSON 输出结构变化（codecraft）；路由结构不兼容、模板字段删除（docscraft / designcraft）。
- **minor**：新能力——CLI 选项、检查规则、适配器、模板、向后兼容字段。
- **patch**：修复、文档、提示词、测试、CI，或无行为变化的内部调整。

codecraft 还写了两条反「版本通胀」的规则：`2.0` 不设时间表，没有破坏性变更就不进 major；跳过的版本号要在 CHANGELOG 里注明「未发布，变更已并入 X.Y.Z」，不留空号（`skills/codecraft/CONTRIBUTING.md:41-44`）。

## 红线：AGENTS.md 的五条

根 `AGENTS.md` 是给 AI 协作者的最短约束（`AGENTS.md:9-15`）：

1. 子包不写 Ultime 内部材料（`docs/roadmap`、`docs/design-system`、`spec/` 等）；
2. 概念/公式用抽象语言，不搬运内部正文；
3. 跨包依赖只用已发布 npm 版本；
4. 功能变更同批更新测试、README、`VERSION`、`CHANGELOG`；
5. 每个 skill 目录独立自包含，不复制其他 skill 或根仓材料。

这五条直接对应发布检查：内部路径/内部包名由 `check-package-content.mjs` 扫（`CONTENT_RULES`），版本一致性由 `release-check.mjs` 查，包自包含由「三份重复脚本」体现。

## 局限与待改进

- **没有根级 CONTRIBUTING**：新贡献者要先进某个 skill 目录才能看到指南；跨包改动没有统一说明。
- **CI 无 Windows / macOS**：上面的反斜杠缺陷就是代价；加一个 `windows-latest` job 跑 `npm test` 即可暴露。
- **没有 lint / format 检查**：代码风格靠人工；对 982 行的 `cli.mjs` 来说，后续可考虑加 ESLint，但会增加依赖，作者显然选择了零依赖。

## 我能偷什么

- **贡献指南按包写，而不是根级一份**：每个包的「改什么必须同步什么」不同，分开放更准确。
- **规则必须带反例**：没有反例的规则降级为参考，避免「看似有规则、实际测不出」。
- **契约类改动整族刷新**：命名/档位/路由这类概念一旦改，必须全链路一起改，禁止零散补丁。
- **发布前跑 eval**：单测保代码，eval 保行为；文档型项目尤其需要后者。
- **tag 与版本强校验**：发布流水线第一件事就是比对，错 tag 直接失败。
- **用 OIDC provenance 替代长期 token**：供应链安全的最小成本做法。
