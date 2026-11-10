# 03 · 代码走读：从 `bin` 到退出码，先读哪 12 个文件

> 这篇回答什么问题：第一次打开这个仓库，目录怎么读、入口在哪、一次检查从参数到退出码经过哪些函数、要加规则或加 skill 改哪里、测试怎么跑。

## 目录树（只列有意义的层）

```text
ultime-space-skills/            203 文件（git ls-files）
├── README.md                  集合索引、三种安装方式、发布约定
├── AGENTS.md                  给 AI/协作者的入口与五条红线
├── SECURITY.md                漏洞报告口径
├── .github/workflows/
│   ├── ci.yml                 三个 skill 并行测试
│   ├── publish.yml            codecraft tag 发布
│   ├── publish-docscraft.yml
│   └── publish-designcraft.yml
└── skills/
    ├── codecraft/             114 文件
    │   ├── SKILL.md           agent 入口 + 任务路由（102 行）
    │   ├── README.md          476 行，CLI 全参数与升级指南
    │   ├── docs/shared/       11 篇：宪法、AI 契约、审计契约、门禁、模式、提示词、安全、身份、存储、术语
    │   ├── docs/frontend/     4 篇：族卡、风格图、架构、审计判定
    │   ├── docs/backend/      4 篇：同上
    │   ├── scenarios/         9 个：前端/后端审计、新项目、架构报告、重构评审、只出报告、agent 循环、规范落地
    │   ├── bin/codecraft.mjs  4 行启动器
    │   ├── src/               7 模块：cli / check / gates / ignore / baseline / plan / init
    │   ├── tests/             10 个 node:test 文件
    │   ├── evals/             cases.json（19 case）+ fixtures + golden-tasks.md（134 行）
    │   └── scripts/           release-check.mjs（62 行）+ check-package-content.mjs（187 行）
    ├── docscraft/             32 文件：SKILL.md + docs/{rules,contracts,guides} + 模板/场景/测试
    └── designcraft/           49 文件：SKILL.md + docs 15 篇 + scenarios 15 个 + 测试
```

## 构建与运行入口

没有构建步骤：纯 ESM、零运行时依赖，Node 直接执行。`bin/codecraft.mjs` 只有四行：

```js
#!/usr/bin/env node
import { main } from '../src/cli.mjs'

process.exit(main(process.argv.slice(2)))
```

（`skills/codecraft/bin/codecraft.mjs:1-4`）

`package.json` 把 `codecraft` 映射到这个文件，`files` 白名单决定发布内容（`skills/codecraft/package.json:30-50`）。开发时直接 `node bin/codecraft.mjs check --root <项目>`，或 `npm link` 后用 `codecraft`。

## 主流程：一次 `check` 的 12 步

1. **解析参数**：`parseArgs(argv)` 处理 `--root/--pack/--format/--changed/--since/--rules/--baseline/--ci` 等；`--rules` 必须匹配 `^A\d+$`，`--update-baseline` 与 `--changed/--since/--rules` 互斥（`skills/codecraft/src/cli.mjs:459-555`）。
2. **校验命令与 root**：只接受 `check/audit/plan/init`；root 不存在 exit 2（`skills/codecraft/src/cli.mjs:81-96`）。
3. **读配置**：`loadConfig(root, args.config)` 读 `codecraft.config.json`，校验 gates/ignore/exclude/boundaries（`skills/codecraft/src/gates.mjs:38-66`）。
4. **决定 pack**：显式 `--pack` 优先；否则 `resolvePack` → `detectPack`，按 `apps/`、`src/pages`、`packages/`、`package.json` 等标记推断（`skills/codecraft/src/cli.mjs:590-598`）。
5. **扫描**：`check(root, { pack, boundaries, exclude })` 按 pack 分派到 `checkApp` / `checkLibrary` / `checkDesignSystem`（`skills/codecraft/src/check.mjs:134-143`）。
6. **文件遍历**：`walk` DFS，跳过 `SKIP_DIRS` 的 18 类目录，只收 8 种扩展名（`skills/codecraft/src/check.mjs:5-27`、`:425-454`）。
7. **规则匹配**：`scanAppFile` 查 A17（内部 import external/generated）与 A6（空 catch）；`checkPackage` 查 A2（包边界）、A11（生成物标记）；`scanSecrets` 查 A21（`skills/codecraft/src/check.mjs:183-203`、`:285-347`）。
8. **收窄范围**：`--changed/--since` 过滤 findings；`--rules` 取 pack 交集，全部不在 pack 内 exit 2（`skills/codecraft/src/cli.mjs:157-210`）。
9. **应用 ignore**：`applyIgnores` 过滤带理由的例外，过期条目单独返回（`skills/codecraft/src/ignore.mjs:54-84`）。
10. **应用 baseline**：`loadBaseline` + `applyBaseline` 抑制存量，critical 密钥不可入基线（`skills/codecraft/src/baseline.mjs:58-75`）。
11. **跑 gates（可选）**：`shouldRunGates` 决定是否执行；`runGates` 走 `spawnSync`，先脱敏再进报告（`skills/codecraft/src/cli.mjs:267-273`、`skills/codecraft/src/gates.mjs:193-249`）。
12. **输出与退出码**：按 `md/json/sarif` 格式化；`enforce && findings>0 || gate 失败` 才 exit 1；warnings 非空 exit 2（`skills/codecraft/src/cli.mjs:289-355`）。

## 先读的 12 个文件（按顺序）

| # | 文件 | 为什么先读 |
|---|---|---|
| 1 | `skills/codecraft/SKILL.md` | 看 agent 如何按任务路由，理解「入口不是正文」（102 行，末尾一句钉死真源） |
| 2 | `skills/codecraft/README.md` | CLI 全参数、Rule Packs、接入档位、升级到 2.0、边界（476 行） |
| 3 | `skills/codecraft/docs/shared/00-constitution.md` | A1–A21 与五条元判据，所有规则的母版（324 行） |
| 4 | `skills/codecraft/docs/shared/04-gates.md` | Universal vs Business 两层门禁，Gate Contract 2.0 |
| 5 | `skills/codecraft/docs/shared/02-ai-contract.md` | AI 输出必须带哪些字段、证据门槛 |
| 6 | `skills/codecraft/src/cli.mjs` | 主流程与所有参数语义；`main()` 到 356 行结束，后面全是格式化 |
| 7 | `skills/codecraft/src/check.mjs` | 扫描与规则实现，831 行，按 pack 分派 |
| 8 | `skills/codecraft/src/gates.mjs` | gate 校验、执行、阈值、脱敏，288 行 |
| 9 | `skills/codecraft/src/ignore.mjs` | 例外登记与 glob 匹配，145 行 |
| 10 | `skills/codecraft/src/baseline.mjs` | 指纹与棘轮，128 行 |
| 11 | `skills/codecraft/src/plan.mjs` | findings → 带宪法条款的修复计划，51 行 |
| 12 | `skills/codecraft/scripts/check-package-content.mjs` | 发布内容扫描，2026-11 新增的「红线机器化」样本 |

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

// skills/codecraft/src/cli.mjs:590
export function detectPack(root)
```

返回值形状可以直接从 `check()` 的返回推断：`{ root, files, findings, coverage }`；findings 每项至少有 `rule/file/line/message/severity`，A21 额外带 `critical: true`（`skills/codecraft/src/check.mjs:634-677`）。

签名背后有三条不写在类型里的约定：所有函数同步、无 Promise/worker；错误通过抛 `Error` 表达，`main()` 统一转 exit 2；返回值都是普通对象，测试可直接 `deepEqual`。

## 数据结构：findings 与 coverage

`check()` 返回 `{ root, files, findings, coverage }`。findings 公共字段 `rule/file/line/message/severity`；A21 额外 `critical: true`，所以 baseline 的 `isBaselineable` 会拒绝它。

coverage 不是装饰：`scanned` 是真正参与规则匹配的文件数，`skippedTests`、`skippedMinified`、`skippedByExclude` 分别记录测试文件、压缩文件、`--exclude` 排除的文件；`unsupportedExtensions` 记录仓库里出现但工具不解析的扩展名；`rules` 按规则给出 `scanned` 与 `limitations`（`skills/codecraft/src/check.mjs:164-181`）。

本机实测（`codecraft check --root skills/codecraft --pack design-system --exclude "evals/fixtures/**"`）：`scanned=7`、A21 的 `scanned=61`。后者更大是因为 A21 扫的扩展名更多（含 `.json/.md/.yml/.sh/.toml` 等，`skills/codecraft/src/check.mjs:34-46`），而结构规则只看 JS/TS。

## 一次最小检查走哪条路

以 `codecraft check --root . --pack app --format json` 为例：`main` 解析参数后调用 `check('.', {pack:'app'})`；`check` 分派到 `checkApp`；`collectAppRoots` 先找 `apps/*/src`、`packages/*/src` 或根 `src`，找不到退回根目录；`walk` 跳过 `node_modules`、`dist`、`.git` 等目录，只保留 8 种扩展名；`isTestFile` 把 `.test.`/`.spec.`/`__tests__` 跳过并计入 `skippedTests`；每个文件过 `scanAppFile` 查 A17 与 A6；最后 `scanSecrets` **单独再遍历一遍**（`skills/codecraft/src/check.mjs:183-203`、`:727-753`）。

所以一次 check 至少有两次文件遍历：一次为结构规则，一次为密钥。这是 05 篇要算的成本来源。

## 增量过滤的真实语义

`--changed` 和 `--since` 看起来像增量扫描，实际上底层还是全量扫描：`changedFiles()` 先用 `git diff --name-only --diff-filter=ACMRT` 拿变更路径，再把 findings 按文件路径过滤。`coverage.scanned` 仍是全量文件数。

两个细节值得抄：
- **按包精确匹配**：library findings 的 `file` 相对包目录，所以比较时要用 `finding.absBase` 换算前缀，不能靠后缀匹配，否则跨包同名路径会误判（`skills/codecraft/src/cli.mjs:184-202`）。
- **CI 下 0 变更直接失败**：干净检出里 `--changed` 必然 0 文件，若静默放行等于门禁失效，所以显式 exit 2 并提示改用 `--since`（`skills/codecraft/src/cli.mjs:203-210`）。

## ignore 与 baseline 的先后

过滤顺序是先 ignore、后 baseline（`skills/codecraft/src/cli.mjs:213-245`）。ignore 是「这条规则在这个文件上不适用」的显式例外，必须带 `rule/file/reason`，可选 `expires`，A21 密钥不允许 ignore（`skills/codecraft/src/ignore.mjs:25-29`）；baseline 是「这些存量问题先记下来」的棘轮，指纹 `rule|file|message` 不含行号，所以上下移动代码不会让基线全失效，但改消息文本会让指纹变化（`skills/codecraft/src/baseline.mjs:13-16`）。

critical 密钥既不能 ignore 也不能进 baseline，这是安全规则高于工程便利的地方。

## 三个 skill 的代码/内容差异

Codecraft 是唯一有「运行时代码」的 skill：`src/` 下 7 个模块，`bin/` 是启动器，`scripts/` 是发布检查。Docscraft 与 Designcraft 没有 `src/`，它们的「实现」就是文档本身，测试围绕文档契约展开：

- **Docscraft**：`terms.test.mjs` 检查术语一致性（3 个用例：术语唯一且翻译、README 首次出现标注、AI 文档裸写）；`structure.test.mjs` 检查 frontmatter、版本、链接、路由、docs 可达，以及 `docs/contracts/01-checklist.md` 是否覆盖全部漂移类型（`skills/docscraft/tests/structure.test.mjs:111-119`）。
- **Designcraft**：`structure.test.mjs` 有 18 个用例，最硬的三条是：每篇 docs 页面开头必须声明 `> 适用：`（`skills/designcraft/tests/structure.test.mjs:157-163`）；`docs/scenarios/prompts/templates` 不得出现 `core`/`kit`/`viewer`/`@ultime`/`门禁`/`packages/` 等实现词（`:165-177`）；不得出现 23 个 CSS 属性名，必须用设计语言（`:179-216`）。

这解释了一个常见误解：不是「三个 skill 都有一套 CLI」，而是「只有 Codecraft 需要可执行检查，另外两个是纯知识包」。

## 错误处理与退出码

`main()` 的退出码只有三档（`skills/codecraft/src/cli.mjs:351-355`）：

| 退出码 | 含义 | 触发条件 |
|---|---|---|
| 0 | 报告模式通过 | 没有 `--ci` / `--severity error`，即使有 findings 也返回 0 |
| 1 | 阻断失败 | `--ci` 或 `--severity error` 下有 findings，或任一 gate 失败 |
| 2 | 用法/配置错误 | root 不存在、配置非法、`--rules` 全不在 pack、0 文件、基线格式不符等 |

两个容易忽略的细节：`0 source files` 会先 push warning，最后 `if (warnings.length) return 2`，所以「没扫到文件」是错误而不是通过；但「baseline 文件不存在」只打印 warning、不抑制、不改退出码，避免把「忘记生成基线」误判为全绿（`skills/codecraft/src/cli.mjs:224-245`、`:263-266`）。

## 常见改动路径表

| 想改什么 | 先改 | 必须同步 |
|---|---|---|
| 规则文案 / 新增不变量 | `docs/shared/00-constitution.md` | SKILL.md 路由、docs 测试、README 规则说明 |
| 新增静态检查 | `src/check.mjs` + `PACK_RULES` | `plan.mjs` 修复动作、`SARIF_RULES`、README Rule Packs、tests、evals |
| 新增 CLI 参数 | `src/cli.mjs` 的 `parseArgs` + `HELP` | README 参数表、`tests/cli.test.mjs` |
| 改 gate 行为 | `src/gates.mjs` | `docs/shared/04-gates.md`、`tests/gates.test.mjs` |
| 改报告格式 | `formatReport` / `formatSarif` | README 输出说明、`evals/run.mjs` 的断言 |
| 改 baseline 指纹 | `src/baseline.mjs` | `tests/baseline.test.mjs`、README 基线章节 |
| 改发布内容规则 | `scripts/check-package-content.mjs` 的 `CONTENT_RULES` / `ALLOW` | `tests/release-content.test.mjs`、AGENTS.md 红线 |
| 改安装/发布 | `package.json.files`、`.github/workflows/*.yml` | 根 README、release-check、CONTRIBUTING |

## 读代码的三个陷阱

1. **`cli.mjs` 982 行不等于主流程 982 行**：`main()` 到 356 行结束，后面是 `formatReport`、`formatSarif` 等格式化函数。
2. **`check.mjs` 的规则函数按 pack 分派**：不要从第一行顺序读；先看 `check()` 的 134-143 行，再跳到对应的 `checkApp`/`checkLibrary`，最后读具体规则。
3. **`evals/fixtures/` 是故意违规的样本**：里面有明文密钥、空 catch、跨层 import；不要当 bug 修，修了反而让 eval 失败。`self-check` 必须带 `--exclude "evals/fixtures/**"`。

## 如果要加一个规则（例如 A22）

按现有「规则进入路径」逐处改，缺一处就出现「文档有、CLI 不查」或「查了但 SARIF 不显示」：

1. `docs/shared/00-constitution.md`：加 A22 的 ID、理由、正例/反例、验收、范围；在「机检现状」表标明是否可机检（`skills/codecraft/docs/shared/00-constitution.md:40-64`、`:315-319`）。
2. `src/check.mjs`：实现扫描函数并在 `checkApp`/`checkPackage` 调用；新 pack 规则加入 `PACK_RULES`（`skills/codecraft/src/cli.mjs:23-27`）。
3. `src/plan.mjs`：若该规则有修复动作，补 `ACTIONS` / `VERIFY` / `CONSTITUTION`（`skills/codecraft/src/plan.mjs:1-27`）。
4. `src/cli.mjs`：新规则 ID 补 `SARIF_RULES`（`skills/codecraft/src/cli.mjs:742-748`）。
5. `tests/`：至少一个正例一个反例；`evals/cases.json` 加 fixture 与期望；README 的 Rule Packs 表同步。

## 如果要加一个 skill

1. 新建 `skills/<name>/`，至少含 `SKILL.md`、`README.md`、`docs/`、`scenarios/`、`prompts/`、`templates/`、`tests/`、`evals/`、`scripts/`、`VERSION`、`CHANGELOG.md`、`LICENSE`、`package.json`。
2. `package.json` 用 `@ultime/<name>`，`files` 白名单照抄现有 skill；`license: MIT`；`engines.node >= 20`。
3. 根 `README.md` 的 Skills 表加一行、结构树加一层（`README.md:44-52`、`:87-121`）。
4. `.github/workflows/ci.yml` 加一个 job；新增 `publish-<name>.yml`，tag 规则 `<name>-v*`，步骤照 `publish.yml`。
5. 复制一份 `release-check.mjs` 与 `check-package-content.mjs`（自包含是有意的重复），跑 `npm test`、`npm run release-check`、`npm pack --dry-run`。

## 测试地图

| 层 | 位置 | 怎么跑 | 覆盖什么 |
|---|---|---|---|
| 单元/集成 | `skills/codecraft/tests/*.test.mjs` | `npm test` | 10 个文件、116 个 `node:test` 用例（本机实测 `node --test` 计数） |
| CLI evals | `skills/codecraft/evals/cases.json` + `run.mjs` | `npm run eval` | 19 个 fixture case，断言 exit code、各规则 findings 数、ignored/expired、coverage、SARIF ruleId |
| 自检 | `npm run self-check` | `codecraft check --root . --pack design-system --exclude "evals/fixtures/**" --ci` | 用自家规则扫自家仓库 |
| 结构测试 | `skills/docscraft/tests/`、`skills/designcraft/tests/` | `npm test` | frontmatter、版本一致、相对链接、路由、docs 可达、纯知识约束、方案卡字段、类型卡数量 |
| 发布检查 | `skills/*/scripts/release-check.mjs` | `npm run release-check` | 版本三方对齐、必填文件在 `files[]`、打包内容扫描 |

`evals` 不是快照测试，而是行为契约：每个 case 是一个临时 fixture 目录，`run.mjs` 用 `spawnSync` 跑真实的 `bin/codecraft.mjs`，断言退出码、按规则分组的 findings 数量、ignored/expired、coverage 与 SARIF 的 `ruleId`（`skills/codecraft/evals/run.mjs:1-87`）。改内部实现不会误报，改外部行为一定被抓。

## 本机跑测试的已知坑（2026-11-10 实测）

在 Windows 检出（`core.autocrlf=true`，仓库无 `.gitattributes`）下直接 `npm test`：

| skill | tests | pass | fail |
|---|---|---|---|
| codecraft | 116 | 102 | 14 |
| docscraft | 16 | 15 | 1 |
| designcraft | 24 | 23 | 1 |

失败分两类，都不是逻辑错误：

1. **CRLF 与正则 `^---\n`**：`structure.test.mjs` 用 `\n` 匹配 frontmatter，CRLF 检出后 `SKILL.md` 是 `---\r\n`，断言失败（`skills/codecraft/tests/structure.test.mjs:24-31`）。
2. **路径分隔符**：findings 的 `file` 由 `path.relative` 生成，Windows 下是 `src\config.ts`，测试断言 `src/config.ts`（`skills/codecraft/src/check.mjs:496`、`skills/codecraft/tests/check.test.mjs:281`）。

第 2 条是**真实的可移植性缺陷**，不只是测试问题：JSON 输出、SARIF 的 `artifactLocation.uri`、`--compare` 的 diff 都会带反斜杠。`ignore.mjs` 的 `matchPath` 会先 `replace(/\\/g,'/')` 归一化（`skills/codecraft/src/ignore.mjs:96-101`），`baseline.mjs` 的 `fingerprint` 也会归一化（`:13-16`），所以豁免与基线跨平台可用；但报告消费者要自己处理。CI 只有 `ubuntu-latest`，所以这条从未暴露（`.github/workflows/ci.yml:9`）。

> 一句话记住：**入口在 `bin/codecraft.mjs`，主流程在 `src/cli.mjs:70-356`，规则在 `check.mjs`，门禁在 `gates.mjs`；加规则要同时改宪法、扫描、plan、SARIF、测试、README 六处；另外三个 skill 的「代码」就是文档，测试是护栏不是产品。**
