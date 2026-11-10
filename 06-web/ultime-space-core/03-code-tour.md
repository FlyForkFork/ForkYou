# 03 · 代码走读：从 `buildCore` 到四份产物

**这篇回答什么问题**：如果明天要改这个仓库，应该从哪个文件读起、主流程经过哪些函数、每个模块的边界在哪、加一个功能要动哪几处。

## 目录树（只列有意义的层）

```text
ultime-space-core/
├── src/
│   ├── build.ts                 # 唯一装配点 buildCore / buildManifest / solveLight
│   ├── seed.ts                  # CoreSeed、DEFAULT_SEED、merge/resolve/seedHash/readJsonc
│   ├── tree.ts                  # Token / Group 与平台无关值类型
│   ├── version.ts               # SCHEMA_VERSION=6.0.0 / ENGINE_VERSION=0.7.0
│   ├── contracts.ts             # auditContracts / countByCategory
│   ├── model/
│   │   ├── skeleton.ts          # space/size/radius/fs/lh/ls/font
│   │   ├── motion.ts            # duration/loop/delay/easing
│   │   ├── light.ts             # shadow/occlusion/highlight/shade + solve()
│   │   └── color/
│   │       ├── derive.ts        # 颜色主链路（966 行）
│   │       ├── math.ts          # WCAG 对比度与反解
│   │       ├── oklch.ts         # sRGB ↔ OKLCH 与色域收敛
│   │       ├── ramp.ts          # 12 档中性灰阶与配方
│   │       └── targets.ts       # 颜色合同目标（单一来源）
│   ├── exporters/
│   │   ├── css.ts               # 树 → CSS 变量
│   │   ├── json.ts              # 树 → 原生 JSON 快照
│   │   └── dtcg.ts              # 树 → DTCG 2025.10
│   ├── tools/
│   │   ├── project.ts           # planProject：一次派生 → ProjectBuild
│   │   ├── tokens.ts            # emitTokens / 产物目录 / 平台过滤
│   │   ├── config.ts            # UltimeConfig 校验
│   │   └── semantics.ts         # 可选语义表：路径校验 + @role.slot 引用
│   ├── studio/
│   │   ├── index.ts             # themeStudio：字段/预设/validate/inspect/preview/export
│   │   ├── selection.ts         # 0.7 选择模型（无头）
│   │   ├── derivation.ts        # 0.7 参数化派生（目前只有 light.form）
│   │   └── fields.ts            # 配置器旋钮清单
│   └── cli/
│       ├── index.ts             # ultime 入口，注册 init/build/inspect/schema
│       └── commands/            # init / build / inspect / schema
├── scripts/
│   ├── build.ts                 # tsx 构建脚本：写盘 / --check / --css-only
│   └── check-model.ts           # 零依赖 / 方向 / 类别隔离 / 载体语法守卫
├── tests/                       # 7 个测试文件，857 行
├── tokens.css / tokens.json / tokens.dtcg.json / kernel.json  # 生成物
└── theme.example.json           # 默认 seed 模板（JSONC）
```

## 构建/运行入口

- **包级构建**：`pnpm build` = `tsx scripts/build.ts && vp build`（`package.json:78-88`）。前者写 token 生成物，后者打库出口。
- **只生成 token**：`pnpm build:tokens` → `scripts/build.ts` 读取 `theme.example.json` 或 `--seed`，调用 `planProject`（`scripts/build.ts:20-35`）。
- **程序入口**：`src/build.ts:57` 的 `buildCore`。
- **CLI 入口**：`src/cli/index.ts`，只负责注册命令，不判断配置、不拼产物。
- **测试入口**：`tests/*.test.ts`，通过 `vp test`（Vitest）运行。

## 主流程走读

以 `ultime build` 为例：

1. **CLI 解析参数**：`src/cli/index.ts` 解析 `--config` / `--cwd` / `--check`，交给 `runBuild`。CLI 层用 `@ultime/cli` 的 `runCli` / `processContext`，自己只保留命令语义。
2. **读配置与 seed**：`src/cli/commands/build.ts` 用 `readConfig` 读 JSONC，字符串 seed 先读成对象；`src/tools/project.ts:45-51` 的 `resolveInputSeed` 明确拒绝把路径直接传给 `planProject`，错误信息是“tokens.seed 是文件路径：请先读取成对象再调用 planProject（CLI 负责读盘）”。这是防止“库偷偷做 I/O”的边界。
3. **校验配置**：`planProject` 调 `validateConfig`，只认 `tokens.seed/platforms/output/semantics`，未知字段报错（`src/tools/project.ts:65-78`）；`platforms` 为空或 `output` 为空会在 studio 的 validate 里再报一次（`src/studio/index.ts:133-147`）。
4. **一次派生**：`buildCore(inputSeed)`（`src/build.ts:57-94`）：
   - `resolveSeed` 深合并默认值，数组整体替换，`null` 保留为显式值（`src/seed.ts:204-225`）；
   - `deriveSkeleton` 生成 18/5/9/9/4/5 档几何与字体（`src/model/skeleton.ts:58-103`）；
   - `prepareLight` 先 `deriveColor`，把 `shadowInk` 与光色交给 `deriveLight`（`src/build.ts:41-49`）；
   - `deriveMotion` 生成 6 档 duration、3 档 loop/delay、4 条 easing（`src/model/motion.ts:47-93`）；
   - 拼成一棵 `{space,size,radius,fs,lh,ls,font,color,shadow,occlusion,highlight,shade,motion}` 树（`src/build.ts:63-78`）。
5. **合同审计**：`auditContracts` 遍历几何、动效、光影、树结构、颜色报告，产出 133 行、34 类 ID（`src/contracts.ts:159-375`）。
6. **发射产物**：`planProject` 调 `emitTokens`；`emitTokens` 固定生成 `tokens.css` / `tokens.json` / `tokens.dtcg.json`，默认再生成 `kernel.json`（`src/tools/tokens.ts:34-47`）。
7. **诊断收敛**：非 `pass` 合同行变成 `contract.<id>` 诊断，`blocking` 为 error、颜色为 warn（`src/tools/project.ts:53-62`）；`exportArtifacts` 有 error 时抛错。

`--check` 分支不写盘：把内存产物与磁盘逐字节比较，drift 退出 1 并提示“产物与源不一致”（`scripts/build.ts:38-48`、`:73-80`）。

## 逐模块走读

### `seed.ts`：所有可调参数的唯一真源

`DEFAULT_SEED` 是一份完整对象（`src/seed.ts:136-198`），分六组：`color`、`skeleton`、`light`、`motion`、`semanticHues`/`semantics`。它不是一个“示例”，而是运行时的基线：`resolveSeed` 用 `merge(DEFAULT_SEED, input)` 把用户输入深合并进去（`:204-225`）。合并规则有三条要记住：对象递归合并；数组整体替换（所以 `fontSize.steps` 给几个就是几个，不会和默认值拼接）；`null` 保留为显式值（用于“清空”某个可选字段）。`stableStringify` 按 key 排序、丢弃 `undefined`，再喂给 FNV-1a 32 位得到 `seedHash`（`:228-246`）。`readJsonc` 是手写状态机，支持 `//` 与 `/* */`，不是 `JSON.parse` 加正则（`:249-297`）。

### `tree.ts`：唯一的中间表示

树只有两种节点：`Token`（`$type` + `$value` + 可选 `$description`）和 `Group`（任意子节点）。值类型全部平台无关：`DimensionValue {value, unit: 'px' | 'em'}`、`ColorValue {colorSpace:'srgb', components, alpha, hex}`、`DurationValue`、`ShadowLayerValue`、`ModeValue<T> {light,dark}`（`src/tree.ts:18-78`）。`walk` 深度优先遍历、`countTokens` 数叶子、`getNode` 按路径取节点、`mergeTrees` 递归合并且 `null` 删除（`:142-179`）。这四个函数是 exporters、selection、contracts 共用的“树 API”，没有隐藏状态。

### `skeleton.ts`：档位公式的样板

`SPACE_TIERS` 是固定 18 档（2 到 160），`SIZE_TIERS` 是固定 5 档（24 到 56），`LINE_HEIGHTS` 4 档、`LETTER_SPACINGS` 5 档（`src/model/skeleton.ts:16-19`）。`deriveSkeleton` 里真正“算”的只有三处：`radius = i * base`（i 从 0 开始，所以第一档是 0）、`fontSize = base + steps[i]`、`lh/ls` 直接取表（`:58-103`）。其余是固定表。这种“表 + 少量公式”的写法让合同可以精确断言档数和步长，也意味着新增一档要同时改表和合同。

### `motion.ts`：公式化动效

`easingFamily(t)` 用四个控制点生成四条曲线：`standard [t,0,1-t,1]`、`decelerate [0,0,1-t,1]`、`accelerate [t,0,1,1]`、`linear [0,0,1,1]`（`src/model/motion.ts:25-33`）。注释说 `t=0.42` 对齐 CSS `ease-in-out` / `ease-out` / `ease-in` 与 Apple Core Animation（`:24`）。`deriveMotion` 生成三组序列：duration `unit × (i+1)`、loop `base × ratio^i`、delay 同理，再加四条 easing token（`:47-93`）。如果 seed 的 `easing` 里直接给了 `standard` 字段，则走 custom 分支、不再生成 family；`easingSource` 会记录是 `family` 还是 `custom`。

### `light.ts`：一盏方向光的五槽闭包

`LEVELS = [1,2,3,4]`。shadow 的 level 1 是两层（contact + inner），level 2–4 是三层（contact + inner halo + outer halo），halo 半径 `blurBase × blurRatio^(n−1)`，默认 8×2^(n−1)（`src/model/light.ts:59-132`）。`directionVector` 用方位角/高度角算方向，`edgeWeights` 把方向投影到四边，`keyLayers` 根据 `form` 决定哪些边亮/暗：`convex` 受光边亮、`concave` 暗边亮、`flat` 返回空（`:66-179`）。`solve({form='convex', depth=2, mode='light'})` 是唯一入口，返回 `highlight.key` / `highlight.ambient` / `shade.key` / `shadow` / `occlusion` 五槽（`:181-195`）。静态树只写 `convex`，其余形态由 studio 的 `deriveTree` 按需重算。

### `color/derive.ts`：最长的一条链

`deriveColor` 从 966 行里按顺序做十件事：主色 HSL→OKLCH、构造中性灰阶、解析画布、生成主色/语义色族、生成面阶、控件底、墨、线、状态、阴影墨，最后把每一步的配对结果 push 进 `report`（`src/model/color/derive.ts:474-965`）。它不直接返回 token，而是返回 `{tree, report, shadowInk, ambientColor, lightColor}` 这类中间量，交给 `build.ts` 拼树、交给 `prepareLight` 算光影。这条链的顺序很重要：`controlBg` 必须在面阶之后、`strong` 必须在 `controlBg` 之后、`shadowInk` 必须在所有族之后（它要看 light/dark 的最深 tone）。

### `contracts.ts`：把模型事实翻译成审计行

`auditContracts` 不是“再算一遍”，而是读 `skeleton/color/light/motion/tree/seed` 这些已派生的结果，逐项对照公式和目标（`src/contracts.ts:159-375`）。它用 `row(id, blocking, pass, actual, target, message)` 生成统一结构，用 `monotonic` / `nearly` / `bezierValid` / `easingFamilyValid` 这些纯函数做判断（`:58-104`）。`ids` 是去重后的 34 类；`total` 是行数 133；`failed` 只数 `blocking && !pass`（`:374-375`）。`countByCategory` 按树的顶层 key 统计（`:379-389`），与合同无关。

### `exporters/*`：只翻译，不生成值

CSS 出口做四件事：把 `dimension` 按类别决定是否转 rem（`SCALABLE = {space,size,radius,fs}`，其余保持 px/em）、把 `ModeValue` 拆成 `--x-light` / `--x-dark` 两个值位加一个无后缀开关、把 shadow 的墨抽成 `--shadow-color-rgb`、在 `prefers-reduced-motion` 下把 duration 改成 0.01ms / delay 改成 0s（`src/exporters/css.ts:31-219`）。JSON 出口输出树形快照，模式值保留 `{light,dark}` 字符串。DTCG 出口把模式值拆成两个 token，并在根节点写 `$extensions['com.ultime.core']`，带 `schemaVersion/engineVersion/seedHash`（`src/exporters/dtcg.ts:82-96`）。

### `tools/project.ts`：一次派生，四个返回

`planProject` 是 0.6 之后所有入口的共同路径（`src/tools/project.ts:65-115`）。它先校验配置，再 `buildCore`，再 `emitTokens`，再 `contractDiagnostics`，最后可选 `validateSemantics`。`contractDiagnostics` 把合同行转成 `contract.<id>`，`blocking` 为 error、否则 warn，`path` 固定 `/tokens/seed`（`:53-62`）。`exportArtifacts` 是兼容入口，内部同样走 `planProject`，有 error 就抛（`:118-124`）。

### `studio/*`：配置器不是另一套构建

`themeStudio` 用 `defineConfigurator` 定义字段、预设、validate/inspect/preview/export（`src/studio/index.ts`）。`buildFor` 只缓存一份 `ProjectBuild`，key 是 `JSON.stringify(config.tokens)`（`:30-46`）；`resultFor` 只有存在 `selection` 或 `derivation` 时才调 `selectBuild`（`:54-58`）。`fields.ts` 手写少量旋钮（色相、彩度、光源、动效、平台/输出），不从派生结果反推清单——这是“配置器只暴露意图，不暴露结果”的代码约束。

### `cli/*`：薄壳

`src/cli/index.ts` 用 `runCli` / `processContext` 注册 `init/build/inspect/schema` 四个命令。`build` 支持 `--check`，`inspect` 只读产物并支持 `--json`，`init` 写配置，`schema` 输出 seed 字段/出口/语义表。命令层不判断合同、不拼产物，所有事实来自 `planProject` / `readConfig`。

## 先读的 12 个文件（按顺序）

| # | 文件 | 为什么读它 |
| --- | --- | --- |
| 1 | `src/build.ts` | 唯一装配点，先看清 274 个 token 是怎么拼出来的 |
| 2 | `src/seed.ts` | 所有可调参数与默认值的唯一真源，先懂输入再懂派生 |
| 3 | `src/tree.ts` | 整个 IR 只有 Token / Group 两种节点；不懂它会误以为 export 在“生成值” |
| 4 | `src/model/skeleton.ts` | 最短的模型，104 行看清“档位公式”长什么样 |
| 5 | `src/model/color/targets.ts` | 28 行，颜色合同目标的单一来源 |
| 6 | `src/model/color/math.ts` | WCAG 相对亮度、`solveAlpha` / `solveCoverage` 的步长与余量 |
| 7 | `src/model/color/derive.ts` | 颜色主链路：色族、面阶、墨、线、状态、报告 |
| 8 | `src/model/light.ts` | 光影五槽与 `solve(form,depth,mode)` 闭包 |
| 9 | `src/contracts.ts` | 133 条合同如何分级，`failed` 为什么只数 blocking |
| 10 | `src/exporters/css.ts` | 模式值、rem、reduced-motion 的出口规则 |
| 11 | `src/tools/project.ts` | 0.6 的单一构建计划，CLI/studio/脚本的共同入口 |
| 12 | `src/studio/selection.ts` | 0.7 的选择模型：纯过滤、诊断、无 kernel 导出 |

## 关键类型与签名

```ts
// src/build.ts:57
export function buildCore(input: SeedInput = {}): CoreResult

// src/build.ts:52
export function solveLight(input: LightSolveInput = {}, seedInput: SeedInput = {}): LightSolveResult

// src/tools/project.ts:65
export function planProject(input: UltimeConfig, seed?: SeedInput): ProjectBuild

// src/studio/selection.ts:219
export function selectBuild(
  build: ProjectBuild,
  selection: SelectionConfig = {},
  derivation: DerivationConfig = {},
): SelectedBuild

// src/studio/derivation.ts:34
export function deriveTree(build: ProjectBuild, derivation: DerivationConfig = {}): DerivedTree

// src/contracts.ts:159
export function auditContracts({ seed, tree, skeleton, color, light, motion }: ContractInput): ContractReport
```

树的值类型（`src/tree.ts:17-78`）：`TokenType` 只有 `dimension / number / duration / color / cubicBezier / fontFamily / shadow / string`；`DimensionValue { value, unit: 'px' | 'em' }`；`ColorValue { colorSpace: 'srgb', components, alpha, hex }`；`ModeValue<T> { light, dark }`；`Token<T> { $type, $value, $description? }`。

## 如果要加一个功能，改哪几个文件

**例 1：新增一档 size（比如 64px）**

1. `src/model/skeleton.ts:17` 的 `SIZE_TIERS` 加值；
2. `src/contracts.ts:174-182` 的 `size-monotonic` 目前硬编码“5 档、8 步递增”，要同步改合同；
3. `tests/core.test.ts` 的“几何族档位与序号一致”补断言；
4. 重跑 `pnpm build:tokens`，四份产物同批提交。

**例 2：新增一个出口平台（比如 SCSS）**

1. 新建 `src/exporters/scss.ts`，只做“树 → 文本”，不重新派生；
2. `src/tools/tokens.ts:13` 的 `TokenPlatform` 加 `'scss'`，`:26-31` 的 `want()` 加分支；
3. `src/exporters/index.ts` 导出；
4. `tests/tools.test.ts` 补平台过滤断言；
5. 不需要改 `buildCore`，这是“新增平台出口不改模型”的直接体现（`DESIGN.md:18-22`）。

**例 3：新增一个颜色族（比如 `brand-secondary`）**

1. `src/seed.ts` 的 `ColorSeed` 加字段、`DEFAULT_SEED` 给默认 hue；
2. `src/model/color/derive.ts` 的 `deriveColor` 在族循环里加一条；固定 chromaRatio / preferredTone 的策略要写清楚；
3. `src/contracts.ts` 的颜色报告会自动跟随 `color.report`，但族数变化会影响 `total`；
4. `tests/core.test.ts` 补“族数/报告条数”的断言，重跑四份产物。

**例 4：把 `primaryHue` 从 222 改到 250，实际会发生什么**

这是一次“只改 seed”的改动，但值得完整走一遍，理解哪些东西会变、哪些不会：

1. `DEFAULT_SEED.color.primaryHue` 不变，改的是项目 seed（`theme.example.json` 或 `ultime.config.json` 的 `tokens.seed`）；
2. `resolveSeed` 合并后，`deriveColor` 把 250 从 HSL 转成 OKLCH，主色 hue 变、tone/chroma 由 `lightness` 与 `chromaRatio` 决定（`src/model/color/derive.ts:480-482`）；默认 `chromaRatio=0`，所以主色仍走 `inkFamily`，只有 `hue-separation` 报告会变（`derive.ts:883-901`）；
3. 语义色 `danger/warning/success/info` 会被主色拉近最多 2°，因为 `pull=1`、`identityBudget=2`（`derive.ts:44-48`）；`hue-separation` 只在 `chromaRatio>0` 时检查，所以默认 seed 下它不出现；
4. `shadowInk` 的 hue 可能借 `ambientColor`，与主色无关；shadow 的几何完全不变（`derive.ts:708-722`）；
5. 合同里所有结构项（space/size/radius/type/motion/light）全部不变；颜色报告的数值会变，但 `total/pass` 计数通常不变；
6. 四份产物中 `tokens.css` / `tokens.json` / `tokens.dtcg.json` / `kernel.json` 都会变（`seedHash` 与 `seed` 字段）；`--check` 会要求同批提交。

结论：**改 seed 的影响面由依赖图决定，不是“全部重算”四个字能概括的**。默认 `chromaRatio=0` 时改 hue 甚至不会改变主色 token，只会改变报告里的色相分离；要让品牌色真正生效，必须同时给 `chromaRatio > 0`。这是阅读代码时最容易踩的“以为改了但没改”。

## 如何定位一个“颜色不对”

假设某个页面的 `--color-tone-primary-solid-fill-rest` 看起来偏暗。按以下顺序查，不要先改 `derive.ts`：

1. **确认读的是哪个变量**：CSS 里实心填充用 `--color-tone-primary-solid-fill-rest`，文字必须配 `--color-tone-primary-solid-foreground`；如果误用了 `--color-ink-primary`，那不是颜色错，是用错 token（`README.md:155-157`）。
2. **看 seed**：`chromaRatio` 是否为 0？为 0 时主色族走 `inkFamily`，取的是中性 900/100 档，不是品牌色（`derive.ts:544-561`）。这是默认 seed 的预期行为。
3. **看报告**：`manifest.color.report` 里找 `tone-primary-solid-fill` 对应的行，看 `level` 是 pass 还是 deviation；如果是 `tone-fill-unreachable`，说明目标对比度在 sRGB 里不可达（`derive.ts:903-917`）。
4. **看模式**：`solid.fill.rest` 是 `ModeValue`，浅色和深色分别算；只改浅色不会影响深色，`mode-complete` 合同会检查两端是否都存在（`contracts.ts:121-131`）。
5. **最后才看算法**：如果报告 pass 但视觉不对，问题通常在消费端——比如把 `-light` 值位当主题开关用，或在深色主题下没有 `data-theme="dark"`。

这个顺序的价值是：大部分“颜色不对”是 token 选择或 seed 语义问题，不是求解器 bug。先把可解释的层排除，再动 966 行的 `derive.ts`。

## 测试与调试路径

`tests/` 共 7 个文件、857 行：

- `core.test.ts`：seed/几何/排版/动效/颜色/光影，含 0.5.0 旧光影名不再出现；
- `selection.test.ts`：按类别、按档位、空选择、未知项、semantics warn、逐字节相同；
- `derivation.test.ts`：convex 不变、flat 清空、concave 可复现、非法形态报错；
- `studio.test.ts`：配置器 validate/inspect/preview/export 与缓存；
- `tools-config.test.ts` / `tools.test.ts`：配置校验、产物平台过滤、兼容入口；
- `cli.test.ts`：init/build/inspect/schema 命令。

跑法：`pnpm test`（`vp test`）；提交前 `pnpm check`（格式 / lint / 守卫 / 产物同源）与 `pnpm typecheck`。

调试顺序建议：先 `buildCore({})` 看 `counts` 与 `contracts.failed`，再 `getNode(tree, ['color','tone','primary'])` 看具体族，最后看 `manifest.color.report` 里对应的 `pair`。如果是产物差异，直接跑 `tsx scripts/build.ts --check`，它会告诉你哪个文件 drift；如果是方向问题，跑 `tsx scripts/check-model.ts`，它会打印 `[model-direction]` 之类的具体 import。

**一句话记住**：读这个仓库先读 `build.ts` 的 38 行装配逻辑，再顺着 `seed.ts → model/* → tree.ts → exporters/*` 走一遍；新增维度改模型，新增出口改 exporter，不要反过来。
