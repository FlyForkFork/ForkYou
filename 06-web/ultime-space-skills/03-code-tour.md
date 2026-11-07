# 03 · 代码走读：从 `bin` 到报告，先读哪 12 个文件

> 这篇回答什么问题：第一次打开这个仓库，目录怎么读、入口在哪、一次检查从参数到退出码经过哪些函数、要加规则或加 skill 改哪里、测试怎么跑。

## 目录树（只列有意义的层）

```text
ultime-space-skills/
├── README.md                 集合索引、三种安装方式、发布约定
├── SECURITY.md               漏洞报告口径
├── .github/workflows/
│   ├── ci.yml                三个 skill 的并行测试
│   ├── publish.yml           codecraft tag 发布
│   ├── publish-docscraft.yml
│   └── publish-designcraft.yml
└── skills/
    ├── codecraft/            112 文件
    │   ├── SKILL.md          agent 入口 + 任务路由表（98 行）
    │   ├── README.md         476 行，CLI 全参数与升级指南
    │   ├── VERSION / package.json / CHANGELOG.md / LICENSE
    │   ├── docs/shared/      宪法、AI 契约、门禁、模式、安全、身份、存储、术语
    │   ├── docs/frontend/    族卡、风格图、架构、审计判定
    │   ├── docs/backend/     族卡、风格图、架构、审计判定
    │   ├── scenarios/        前端/后端审计、新项目、架构报告、重构评审
    │   ├── adapters/generic/ AGENTS.md 手动指针
    │   ├── prompts/          输出格式
    │   ├── templates/        init 骨架 + 报告模板
    │   ├── bin/codecraft.mjs 4 行启动器
    │   ├── src/              cli / check / gates / ignore / baseline / plan / init
    │   ├── tests/            10 个 node:test 文件，109 个用例
    │   ├── evals/            cases.json（19 个）+ fixtures + golden-tasks.md
    │   └── scripts/release-check.mjs
    ├── docscraft/            30 文件：SKILL.md + docs/{rules,contracts,guides} + 模板/场景/测试
    └── designcraft/          43 文件：SKILL.md + docs 13 篇 + 模板/场景/测试
```

## 构建与运行入口

没有构建步骤：纯 ESM、零运行时依赖，Node 直接执行。`bin/codecraft.mjs` 只有四行：

```js
#!/usr/bin/env node
import { main } from '../src/cli.mjs'
process.exit(main(process.argv.slice(2)))
```

（`skills/codecraft/bin/codecraft.mjs:1-4`）

`package.json` 把 `codecraft` 命令映射到这个文件（`skills/codecraft/package.json:30-32`），`files` 白名单决定发布内容（`skills/codecraft/package.json:33-50`）。开发时直接 `node bin/codecraft.mjs check --root <项目>`，或 `npm link` 后使用 `codecraft`。

## 主流程：一次 `check` 的 12 步

1. **解析参数**：`parseArgs(argv)` 处理 `--root/--pack/--format/--changed/--since/--rules/--baseline/--ci` 等；`--rules` 必须匹配 `^A\d+$`，`--update-baseline` 与 `--changed/--since/--rules` 互斥（`skills/codecraft/src/cli.mjs:459-555`）。
2. **校验命令与 root**：只接受 `check/audit/plan/init`；root 不存在直接 exit 2（`skills/codecraft/src/cli.mjs:81-95`）。
3. **读配置**：`loadConfig(root, args.config)` 读 `codecraft.config.json`，校验 gates/ignore/exclude/boundaries（`skills/codecraft/src/gates.mjs:38-66`）。
4. **决定 pack**：显式 `--pack` 优先；否则 `resolvePack` → `detectPack`，按 `apps/`、`src/pages`、`packages/`、`package.json` 等标记推断（`skills/codecraft/src/cli.mjs:590-598`）。
5. **扫描**：`check(root, { pack, boundaries, exclude })` 按 pack 分派到 `checkApp` 或 `checkPackages`（`skills/codecraft/src/check.mjs:134-143`）。
6. **文件遍历**：`walk` DFS，跳过 `SKIP_DIRS`（node_modules/dist/.git/.claude 等 18 类目录），只收 `.ts/.tsx/.js/.jsx/.mjs/.cjs/.vue/.svelte`（`skills/codecraft/src/check.mjs:5-27`、`skills/codecraft/src/check.mjs:425-454`）。
7. **规则匹配**：`scanAppFile` 查 A17（内部 import external/generated）与 A6（空 catch）；`checkPackage` 查 A2（包边界）、A11（生成物标记）；`scanSecrets` 查 A21（`skills/codecraft/src/check.mjs:183-203`、`skills/codecraft/src/check.mjs:285-347`）。
8. **收窄范围**：`--changed/--since` 过滤 findings；`--rules` 取 pack 交集；全部不在 pack 内 exit 2（`skills/codecraft/src/cli.mjs:157-210`）。
9. **应用 ignore**：`applyIgnores` 过滤带理由的例外，过期条目单独返回（`skills/codecraft/src/ignore.mjs:54-84`）。
10. **应用 baseline**：`loadBaseline` + `applyBaseline` 抑制存量，critical 密钥不可入基线（`skills/codecraft/src/baseline.mjs:58-75`）。
11. **跑 gates（可选）**：`shouldRunGates` 决定是否执行；`runGates` 走 `spawnSync`，先脱敏再进报告（`skills/codecraft/src/cli.mjs:267-273`、`skills/codecraft/src/gates.mjs:193-249`）。
12. **输出与退出码**：按 `md/json/sarif` 格式化；`enforce && findings>0 || gate 失败` 才 exit 1；0 文件等警告 exit 2（`skills/codecraft/src/cli.mjs:314-355`）。

## 先读的 12 个文件（按顺序）

| # | 文件 | 为什么先读 |
|---|---|---|
| 1 | `skills/codecraft/SKILL.md` | 看 agent 如何按任务路由，理解「入口不是正文」 |
| 2 | `skills/codecraft/README.md` | CLI 全参数、Rule Packs、升级到 2.0、边界 |
| 3 | `skills/codecraft/docs/shared/00-constitution.md` | A1–A21 与五条元判据，所有规则的母版 |
| 4 | `skills/codecraft/docs/shared/04-gates.md` | Universal vs Business 两层门禁，Gate Contract 2.0 |
| 5 | `skills/codecraft/docs/shared/02-ai-contract.md` | AI 输出必须带哪些字段、证据门槛 |
| 6 | `skills/codecraft/src/cli.mjs` | 主流程与所有参数语义，982 行但结构清晰 |
| 7 | `skills/codecraft/src/check.mjs` | 扫描与规则实现，831 行，按 pack 分派 |
| 8 | `skills/codecraft/src/gates.mjs` | gate 校验、执行、阈值、脱敏，288 行 |
| 9 | `skills/codecraft/src/ignore.mjs` | 例外登记与 glob 匹配，145 行 |
| 10 | `skills/codecraft/src/baseline.mjs` | 指纹与棘轮，128 行 |
| 11 | `skills/codecraft/src/plan.mjs` | findings → 带宪法条款的修复计划，51 行 |
| 12 | `skills/codecraft/src/init.mjs` | 脚手架生成与路径安全，119 行 |

## 关键签名

```js
// skills/codecraft/src/cli.mjs:70
export function main(argv)

// skills/codecraft/src/check.mjs:134
export function check(root, options = {})

// skills/codecraft/src/gates.mjs:38
export function loadConfig(root, configPath)

// skills/codecraft/src/gates.mjs:193
export function runGates(root, gates, options = {})

// skills/codecraft/src/ignore.mjs:54
export function applyIgnores(findings, exceptions, options = {})

// skills/codecraft/src/baseline.mjs:63
export function applyBaseline(findings, baseline)

// skills/codecraft/src/plan.mjs:29
export function buildPlan(findings)

// skills/codecraft/src/init.mjs:21
export function buildInitPlan(root, pack, name = '')
```

返回值形状可以直接从 `check()` 的返回推断：`{ root, files, findings, coverage }`；findings 每项至少有 `rule/file/line/message/severity`，A21 额外带 `critical: true`（`skills/codecraft/src/check.mjs:634-677`）。

签名背后还有三条不写在类型里的约定。第一，所有函数都是同步的，没有 Promise、没有 worker，调用方不需要 await；这让 CLI 可以在一个进程里顺序完成扫描、过滤、格式化。第二，错误通过抛出 `Error` 表达，`main()` 用统一的 try/catch 转成 exit 2，而不是每个函数返回错误码。第三，返回值都是普通对象，没有 class 或接口，测试可以直接 `deepEqual` 断言，也让 JSON 序列化不需要额外转换。

## 数据结构：findings 与 coverage

`check()` 返回 `{ root, files, findings, coverage }`。findings 的公共字段是 `rule/file/line/message/severity`；A21 密钥 finding 额外带 `critical: true`，所以 baseline 的 `isBaselineable` 会拒绝它。coverage 不是装饰：`scanned` 是真正参与规则匹配的文件数，`skippedTests`、`skippedMinified`、`skippedByExclude` 分别记录测试文件、压缩文件、`--exclude` 排除的文件；`unsupportedExtensions` 记录仓库里出现但工具不解析的扩展名；`rules` 按规则给出 `scanned` 与 `limitations`（`skills/codecraft/src/check.mjs:164-181`）。报告里的 Coverage 行就是这些字段的汇总，用来回答「0 findings 到底是没问题，还是没扫到」。

## 一次最小检查走哪条路

以 `codecraft check --root . --pack app --format json` 为例：`main` 解析参数后调用 `check('.', {pack:'app'})`；`check` 分派到 `checkApp`；`collectAppFiles` 先找 `apps/*/src`、`packages/*/src` 或根 `src`，找不到就退回根目录；`walk` 跳过 `node_modules`、`dist`、`.git` 等目录，只保留 8 种扩展名的文件；`isTestFile` 把 `.test.`/`.spec.`/`__tests__` 跳过并计入 `skippedTests`；每个文件过 `scanAppFile` 查 A17 与 A6；最后 `scanSecrets` 单独再遍历一遍，检查密钥并计入 `secretFiles`。所以一次 check 至少有两次文件遍历：一次为规则，一次为密钥；这是后面性能篇要算的成本来源（`skills/codecraft/src/check.mjs:368-385`、`skills/codecraft/src/check.mjs:727-753`）。

## 增量过滤的真实语义

`--changed` 和 `--since` 看起来像增量扫描，实际上底层还是全量扫描：`changedFiles()` 先用 `git diff --name-only --diff-filter=ACMRT` 拿到变更路径，再把 findings 按文件路径过滤。所以 `coverage.scanned` 仍是全量文件数，不是变更文件数；如果仓库很大，这个参数只减少「报告里的噪音」，不减少扫描成本。`--since` 与 `--changed` 的区别是前者比较 `since...HEAD`，后者比较工作区与 `HEAD`（`skills/codecraft/src/cli.mjs:557-579`）。CI 里干净工作区没有未提交变更，`--changed` 会得到 0 个文件并 exit 2，所以文档建议 CI 用 `--since`，这是升级时常见的坑。

## ignore 与 baseline 的先后

过滤顺序是先 ignore、后 baseline（`skills/codecraft/src/cli.mjs:213-245`）。ignore 是「这条规则在这个文件上不适用」的显式例外，必须带理由与 A12 引用，A21 密钥不允许 ignore；baseline 是「这些存量问题先记下来」的棘轮，指纹用 `rule|file|message`、不含行号，所以上下移动代码不会让基线全失效，但改消息文本会让指纹变化。critical 密钥既不能 ignore 也不能进 baseline，这是安全规则高于工程便利的地方（`skills/codecraft/src/ignore.mjs:25-29`、`skills/codecraft/src/baseline.mjs:13-16`）。

## 三个 skill 的代码/内容差异

Codecraft 是唯一有「运行时代码」的 skill：`src/` 下 7 个模块（cli / check / gates / ignore / baseline / plan / init），`bin/` 是启动器，`scripts/` 是发布检查。Docscraft 与 Designcraft 没有 `src/`，它们的「实现」就是文档本身，测试也围绕文档契约展开：

- Docscraft 的 `terms.test.mjs` 检查术语一致性；`structure.test.mjs` 检查 frontmatter、版本、链接、路由，以及 `docs/contracts/01-checklist.md` 是否覆盖全部漂移类型（D1–D13）。
- Designcraft 的 `structure.test.mjs` 要求每篇 docs 页面开头声明 `> 适用：`，并检查 docs/scenarios/prompts/templates 不出现 CSS 属性名——它刻意让「设计知识」与具体实现解耦（`skills/designcraft/tests/structure.test.mjs:153-224`）。

这解释了一个常见误解：不是「三个 skill 都有一套 CLI」，而是「只有 Codecraft 需要可执行检查，另外两个是纯知识包」。

Docscraft 与 Designcraft 的测试数量不多，却覆盖了最容易漂移的契约：frontmatter 的 name 与目录名一致、VERSION 与 package.json 一致、README 链接可达、SKILL.md 路由提到的文件存在。它们没有覆盖率概念，因为内容仓库的「覆盖率」是文档可达性，不是代码行数。读这两个 skill 时不要从 tests 开始，而要从 `docs/rules/` 或 `docs/foundations/` 的正文开始；测试只是护栏，规则正文才是产品。如果只想快速判断这两个 skill 值不值得用，读 README 的目录与两篇规则正文即可，不必读完全部文档；它们提供的是检查表与判断框架，不是可执行代码。这也是读任何内容仓库的通用方法：先看产品，再看护栏。

## 错误处理与退出码

`main()` 的退出码只有三档（`skills/codecraft/src/cli.mjs:350-355`）：

| 退出码 | 含义 | 触发条件 |
|---|---|---|
| 0 | 报告模式通过 | 没有 `--ci` / `--severity error`，即使有 findings 也返回 0 |
| 1 | 阻断失败 | `--ci` 或 `--severity error` 下有 findings，或任一 gate 失败 |
| 2 | 用法/配置错误 | root 不存在、配置非法、`--rules` 全不在 pack、0 文件、基线格式不符等 |

两个容易忽略的细节：`0 source files` 会先 push warning，最后 `if (warnings.length) return 2`，所以「没扫到文件」是错误而不是通过；但「baseline 文件不存在」只打印 warning、不抑制，也不改变退出码，避免把「忘记生成基线」误判为「全绿」（`skills/codecraft/src/cli.mjs:224-245`、`skills/codecraft/src/cli.mjs:263-266`）。

## 常见改动路径表

| 想改什么 | 先改 | 必须同步 |
|---|---|---|
| 规则文案 / 新增不变量 | `skills/codecraft/docs/shared/00-constitution.md` | SKILL.md 路由、docs 测试、README 规则说明 |
| 新增静态检查 | `skills/codecraft/src/check.mjs` + `PACK_RULES` | `plan.mjs` 修复动作、`SARIF_RULES`、README Rule Packs、tests、evals |
| 新增 CLI 参数 | `skills/codecraft/src/cli.mjs` 的 `parseArgs` + `HELP` | README 参数表、`tests/cli.test.mjs` |
| 改 gate 行为 | `skills/codecraft/src/gates.mjs` | `docs/shared/04-gates.md`、`tests/gates.test.mjs` |
| 改报告格式 | `formatReport` / `formatSarif` | README 输出说明、`evals/run.mjs` 的断言 |
| 改 baseline 指纹 | `skills/codecraft/src/baseline.mjs` | `tests/baseline.test.mjs`、README 基线章节 |
| 改安装/发布 | `package.json.files`、`.github/workflows/*.yml` | 根 README、release-check、CONTRIBUTING |

## 读代码的三个陷阱

1. **`cli.mjs` 982 行不等于主流程 982 行**：`main()` 到 356 行结束，后面全是 `formatReport`、`formatSarif`、`formatInit`、`header` 等格式化函数；先读 main，再按需读格式化。
2. **`check.mjs` 的规则函数按 pack 分派**：不要从第一行顺序读；先看 `check()` 的 134-143 行，再跳到对应的 `checkApp`/`checkPackages`，最后读具体规则。
3. **`evals/fixtures/` 是故意违规的样本**：里面有明文密钥、空 catch、跨层 import；不要把它们当 bug 修，修了反而让 eval 失败。
4. **Docscraft / Designcraft 没有 `src/`**：找不到 CLI 不是仓库缺文件，而是定位不同；它们的「代码」在 docs 的规则与模板里。

## 如果要加一个规则（例如 A22）

按现有代码的「规则进入路径」逐处改，缺一处就会出现「文档有、CLI 不查」或「查了但 SARIF 不显示」：

1. `docs/shared/00-constitution.md`：加 A22 的 ID、理由、正例/反例、验收、范围；同时在「机检现状」表里标明它是否可机检（`skills/codecraft/docs/shared/00-constitution.md:40-64`、`:315-319`）。
2. `src/check.mjs`：实现扫描函数，并在 `checkApp`/`checkPackage` 里调用；如果是新 pack 规则，加入 `PACK_RULES`（`skills/codecraft/src/cli.mjs:22-27`）。
3. `src/plan.mjs`：如果该规则有修复动作，补 `ACTIONS` / `VERIFY` / `CONSTITUTION`（`skills/codecraft/src/plan.mjs:1-27`）。
4. `src/cli.mjs`：如果是新规则 ID，补 `SARIF_RULES` 与报告映射（`skills/codecraft/src/cli.mjs:742-748`）。
5. `tests/`：补至少一个正例、一个反例；`evals/cases.json` 加 fixture 与期望；`README.md` 的 Rule Packs 表同步。
6. `docs/shared/04-gates.md`：如果该规则要进门禁，补 gate 契约说明。

## 如果要加一个 skill

1. 新建 `skills/<name>/`，至少包含 `SKILL.md`、`README.md`、`docs/`、`scenarios/`、`prompts/`、`templates/`、`tests/`、`evals/`、`VERSION`、`CHANGELOG.md`、`LICENSE`、`package.json`。
2. `package.json` 用 `@ultime/<name>` 命名，`files` 白名单照抄现有 skill 的字段集；`license: MIT`；`engines.node >= 20`。
3. 根 `README.md` 的 Skills 表加一行，仓库结构树加一层；`README.md:49-53` 是现有写法。
4. `.github/workflows/ci.yml` 加一个 job；新增 `.github/workflows/publish-<name>.yml`，tag 规则 `<name>-v*`，步骤照 `publish.yml`（`.github/workflows/publish.yml:1-51`）。
5. 跑 `npm test`、`npm run release-check`、`npm pack --dry-run`，确认 `files` 白名单包含全部必填目录。

## 测试地图

| 层 | 位置 | 怎么跑 | 覆盖什么 |
|---|---|---|---|
| 单元/集成 | `skills/codecraft/tests/*.test.mjs` | `npm test` | 109 个 `node:test` 用例：check 25、cli 25、gates 13、detect 11、baseline 8、init 8、structure 7、ignore 6、docs 3、plan 3 |
| CLI evals | `skills/codecraft/evals/cases.json` + `evals/run.mjs` | `npm run eval` | 19 个 fixture case，断言 exit code、各规则 findings 数、ignored/expired、coverage、SARIF ruleId |
| 自检 | `npm run self-check` | `codecraft check --root . --pack design-system --exclude "evals/fixtures/**" --ci` | 用自家规则扫自家仓库 |
| 结构测试 | `skills/docscraft/tests/structure.test.mjs`、`skills/designcraft/tests/structure.test.mjs` | `npm test` | frontmatter、版本一致、相对链接、路由路径、docs 可达性、纯知识约束 |
| 发布检查 | `skills/*/scripts/release-check.mjs` | `npm run release-check` | VERSION=semver=package.version、CHANGELOG 有当前版本段、必填文件/目录都在 files[] |

Codecraft 的 `structure.test.mjs` 还会检查「CLI help 的 pack 规则与 README 表格一致」（`skills/codecraft/tests/structure.test.mjs:92-106`），这是防止文档与实现漂移的一个很实用的低成本测试。

`evals` 不是快照测试，而是「行为契约」：每个 case 是一个临时 fixture 目录，`run.mjs` 用 `spawnSync` 跑真实的 `bin/codecraft.mjs`，然后断言退出码、按规则分组的 findings 数量、ignored/expired 数量、coverage 字段和 SARIF 的 `ruleId`。这样改内部实现不会误报，改外部行为一定会被抓住。代价是 fixture 多、跑得比单元测试慢，所以它放在 `npm test` 之后单独跑，CI 里也分成两个 step。新增规则时，最值得抄的就是这种「真实进程 + 行为断言」的方式，而不是给每个函数写 mock。

如果要给一个规则补测试，最小组合是：`tests/<rule>.test.mjs` 覆盖函数级正反例；`evals/cases.json` 加一个 fixture 目录与期望；`evals/run.mjs` 通常不用改。只写单元测试不写 eval，容易出现「函数对、CLI 接线错」的盲区；只写 eval 不写单元测试，失败时定位会很慢。

> 一句话记住：**入口在 `bin/codecraft.mjs`，主流程在 `skills/codecraft/src/cli.mjs:70-356`，规则在 `check.mjs`，门禁在 `gates.mjs`；加规则要同时改宪法、扫描、plan、SARIF、测试、README 六处。**
