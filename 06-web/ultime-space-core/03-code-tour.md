# 03 · 代码走读：从 71 个文件里找到那 10 个

> 结论先行：读这个仓库不要从 `README` 开始，也不要从 CLI 开始。正确顺序是 `src/build.ts`（装配）→ `src/seed.ts`（输入）→ `src/tree.ts`（IR）→ 四个模型 → 一个 exporter → 合同与守卫。抓住 `buildCore` 这一条线，剩下的都是枝叶。全仓库 71 个文件，真正需要精读的不到 10 个。

## 目录树（只列关键路径）

```text
ultime-space-core/
├── src/
│   ├── build.ts              # 唯一装配点：buildCore / buildManifest / prepareLight
│   ├── seed.ts               # CoreSeed 类型、DEFAULT_SEED、merge/resolve/seedHash/readJsonc
│   ├── tree.ts               # Token/Group/值类型、walk/count/merge
│   ├── contracts.ts          # 133 条合同：结构阻断 + 颜色报告
│   ├── model/
│   │   ├── skeleton.ts       # 空间/尺寸/圆角/字号/行高/字距/字体
│   │   ├── color/
│   │   │   ├── targets.ts    # 面/线/墨/状态/前景目标常量
│   │   │   ├── math.ts       # 对比度、混色、覆盖度/alpha 反解
│   │   │   ├── oklch.ts      # sRGB↔OKLab、色域边界
│   │   │   ├── ramp.ts       # 中性灰配方、画布对称、阶梯曲线
│   │   │   └── derive.ts     # 颜色主链路（966 行）
│   │   ├── light.ts          # 阴影/遮挡/环境光/受光边
│   │   └── motion.ts         # 时长/循环/延迟/缓动
│   ├── exporters/
│   │   ├── css.ts            # 树→CSS 变量
│   │   ├── json.ts           # 树→JSON
│   │   └── dtcg.ts           # 树→DTCG
│   ├── tools/                # config/tokens/tokens-config/semantics
│   ├── cli/                  # init/build/schema
│   └── studio/               # themeStudio 配置器
├── scripts/
│   ├── build.ts              # 四产物生成 + --check
│   └── check-model.ts        # 四类守卫
├── tests/                    # core/cli/studio/tools/tools-config
├── rules/                    # 01-architecture / 02-tokens / 03-testing / 04-release
├── .githooks/pre-commit
├── .github/workflows/        # ci.yml / publish.yml
└── package.json
```

## 入口在哪

包对外有三个入口，按使用方式分：

1. **库入口**：`import { buildCore } from '@ultime/core'`，根入口 `src/index.ts` 汇总 seed/tree/build/contracts/exporters/version（`src/index.ts:9-15`）；`./seed`、`./exporters`、`./tools`、`./studio` 是四个子入口（`package.json` 的 exports 字段）。CLI 是 `bin/ultime.js`，不作为包导出路径。
2. **命令行入口**：`bin ultime → bin/ultime.js`，6 行薄入口，import `../dist/cli.js`；真正逻辑在 `src/cli/index.ts:50-86`，注册 `init`、`build`、`schema` 三个命令。
3. **构建脚本入口**：`pnpm build:tokens` → `tsx scripts/build.ts`，默认读 `theme.example.json`，产出四份文件到包根（`scripts/build.ts:28`、`34-39`）。

如果你只想验证「这个库能不能跑」，最短路径是 `node -e "import('@ultime/core').then(m => console.log(m.buildCore({}).counts))"`（前提是已构建）；如果想看完整产物，跑 `pnpm build:tokens`。

## 主流程：跟着一次 CLI build 走

以 `ultime build` 为例，调用链是：

1. `src/cli/index.ts:50-86` 解析参数，读 `--config` 或默认 `ultime.config.json`；配置没给 seed 时才用 `theme.example.json`（`src/cli/commands/build.ts:43-49`）。
2. `src/cli/commands/build.ts:30-82` 调 `validateConfig`，然后 `exportArtifacts`；`--check` 时逐字节比较，否则写盘。
3. `src/tools/config.ts:44-131` 校验配置：未知字段报错（拼错的字段不会被静默忽略）、seed 支持对象或路径、subset 必须九维全给、platforms 非空、semantics 模板/覆盖形状正确。
4. `src/tools/tokens.ts:26-50` 调 `buildCore`，再按 platforms 过滤生成四份产物；`kernel.json` 永远保留。
5. 如果配置了 `semantics`，`src/tools/semantics.ts:110-156` 校验路径存在、`@role.slot` 引用存在、无环，然后追加 `semantics.json`。

注意第 3 步的「未知字段报错」：很多配置系统会静默忽略拼写错误，这里选择 fail fast，因为设计 token 的拼错往往要到视觉验收才发现。

## 先读的 10 个文件

| 顺序 | 文件 | 为什么先读 | 建议关注 |
|---|---|---|---|
| 1 | `src/build.ts` | 唯一装配点，129 行看完整条流水线 | `buildCore` 的 7 个步骤、`prepareLight` 的跨模型数据 |
| 2 | `src/seed.ts` | 所有输入的唯一真源 | `DEFAULT_SEED`、`merge` 的数组/null 规则、`seedHash` |
| 3 | `src/tree.ts` | IR 的全部类型，180 行 | `Token`/`Group`/`ModeValue`、`walk` 的稳定顺序 |
| 4 | `src/model/skeleton.ts` | 最简单的模型，先建立「档位派生」直觉 | 18 档 space、9 档 radius 的 `i*base` |
| 5 | `src/model/color/targets.ts` | 28 行，颜色系统的「宪法」 | 面/线/墨/状态目标值 |
| 6 | `src/model/color/math.ts` | 对比度与反解工具，202 行 | `contrast`、`solveCoverage`、`solveAlpha` |
| 7 | `src/model/color/derive.ts` | 颜色主链路，966 行，不必逐行 | `deriveColor` 的输入输出、`deriveAccentFamily` |
| 8 | `src/contracts.ts` | 合同是「可执行的规格」 | `auditContracts` 的 blocking 判定 |
| 9 | `src/exporters/css.ts` | 最复杂的出口，220 行 | 模式值拆分、rem 转换、reduced-motion |
| 10 | `scripts/check-model.ts` | 四类守卫，90 行 | import 扫描与默认树正则 |

如果只有半小时，读 1、2、3、5、9；这五个文件能让你回答「seed 怎么变成 CSS」的 80%。读完后的自检标准：能不看代码画出 `seed → 四个模型 → 树 → 三个 exporter` 的数据流，能说出 `prepareLight` 为什么存在，能指出新增一个 token 要改哪五处。做不到就回到 `src/build.ts:57-94` 再读一遍。这份走读不追求覆盖每一行，而是帮你建立一张能反复使用的地图。

## 关键签名

```ts
// src/build.ts
export function buildCore(input: SeedInput = {}): CoreResult;
export function buildManifest(result: CoreResult);
export function solveLight(input: LightSolveInput = {}, seedInput: SeedInput = {}): LightSolveResult;
// prepareLight 是 src/build.ts:42 的私有函数，不导出

// src/seed.ts
export function resolveSeed(input: SeedInput = {}): CoreSeed;
export function stableStringify(value: unknown): string;
export function seedHash(seed: CoreSeed): string;
// merge 是 src/seed.ts:204 的私有函数，不导出

// src/tree.ts
export const token = <T>($type: TokenType, $value: T, $description?: string): Token<T>;
export function walk(node: Node, visit: (path: string[], node: Token | Group) => void, path?: string[]): void;
export function mergeTrees(base: Group, overlay: Group): Group;

// src/contracts.ts
export interface ContractInput { seed: CoreSeed; tree: Group; skeleton: SkeletonResult; color: ColorResult; light: LightResult; motion: MotionResult }
export function auditContracts(input: ContractInput): ContractReport;
export function countByCategory(tree: Group): Record<string, number>;
```

这些签名有一个共同点：**输入输出都是纯数据**，没有 class、没有 this、没有隐式上下文。这使得它们可以在 CLI、Studio、测试里任意组合。

## 加功能：改哪些文件

### 场景 A：新增一个 token（例如 elevation）

1. `src/tree.ts:18-26` 加 `$type`（如果现有类型不够）。
2. `src/model/skeleton.ts` 或新模型文件里加派生函数。
3. `src/build.ts:70-90` 把新组挂到树上。
4. `src/contracts.ts` 加合同（档位、派生关系、模式完整性）。
5. `tests/core.test.ts` 加回归；`tests/core.test.ts:220-223` 的「默认合同全过」必须继续通过。
6. 跑 `pnpm build:tokens` 重算四份产物，再 `pnpm check`。

### 场景 B：新增一个出口（例如 Android XML）

1. 在 `src/exporters/` 新建 `android.ts`，只依赖 `src/tree.ts`，不得 import `build` 或 `model`。
2. 在 `src/tools/tokens.ts:26-50` 的 platforms 列表加 `android`，决定是否始终生成。
3. 在 `src/tools/config.ts:36-38` 的 `PLATFORMS` 加白名单。
4. 在 `src/cli/commands/schema.ts` 暴露给 Studio 的 schema（如果可配置）。
5. 加测试：至少覆盖一个模式值、一个 dimension、一个 shadow。

### 场景 C：新增一个 seed 旋钮

1. `src/seed.ts` 的类型与 `DEFAULT_SEED` 同时加，保持默认值可解释。
2. 在对应模型里消费它；不要新增全局变量。
3. 如果它影响合同，`src/contracts.ts` 与 `tests/core.test.ts` 同步改。
4. 更新 `theme.example.json` 的注释版示例（这是给人看的默认值镜像，不是第二真源）。
5. 更新 `src/studio/fields.ts` 的表单字段，否则 Studio 看不到。

## 测试怎么跑

```bash
pnpm install --frozen-lockfile   # Node >= 22.18，pnpm 12.6.0
pnpm check                       # 格式 + lint + 守卫 + 产物同源
pnpm test                        # 5 个测试文件
pnpm typecheck                   # tsc --noEmit
pnpm build:tokens                # 重新生成四份产物
```

测试分布：`tests/core.test.ts` 283 行是主力，覆盖确定性、几何、颜色、光影、合同、出口；`tests/cli.test.ts` 94 行做 init/build --check/schema 冒烟；`tests/tools*.test.ts` 覆盖配置校验与 subset；`tests/studio.test.ts` 41 行验证配置器与构建同源。CI 只跑 `pnpm check` 与 `pnpm test`（`.github/workflows/ci.yml:30-34`），typecheck 没进 CI，这是一个小缺口（推断：可能由 `vp check` 覆盖部分类型检查，待查实）。

## 颜色链路怎么读（`derive.ts` 966 行不迷路）

`derive.ts` 是仓库最长的文件，但结构很清楚，可以按「输入 → 中性 → 语义 → 表面 → 墨/线 → 状态 → 报告」七段读：

1. **输入处理**（`src/model/color/derive.ts:474-542`）：校验 onSide、把主色转 OKLCH、生成两套中性 ramp、解析画布档位、准备语义色 hue 列表与警告数组。
2. **中性灰与画布**（`src/model/color/derive.ts:485-524`）：`neutralRamps` 返回 light/dark 两套，`resolveCanvas` 支持 `neutral.100` 或 hex；`canvasSymmetry` 在这里生效。
3. **色族**（`src/model/color/derive.ts:544-582`）：主色走 `inkFamily`（chromaRatio=0）或 `deriveAccentFamily`；四个语义色固定 chromaRatio .9、preferredTone 60。
4. **表面**（`src/model/color/derive.ts:584-634`）：tint、alpha、faceContrast、themeMix、controlBg、strong。
5. **墨与线**（`src/model/color/derive.ts:636-683`）：墨的 base alpha 与四面对比度取最大值；线按 1.16/1.45/3.0 反解覆盖度。
6. **状态与阴影墨**（`src/model/color/derive.ts:685-722`）：状态目标 1.08/1.12/1.03；阴影墨 tone/chroma 封顶。
7. **报告**（`src/model/color/derive.ts:724-945`）：所有面/线/墨/色族配对、hue separation、foreground endpoint、contrastAllow。

读的时候不要从第一行开始逐行；先看函数签名与返回类型（`ColorResult`），再按上面的分段跳读。真正需要精读的是 `solveFillTone`、`familyParts`、`solveCoverage` 三个函数，其余是数据组装。

## 出口怎么读（CSS 是最复杂的一个）

`src/exporters/css.ts` 220 行，核心只有 `treeToCss` 一个函数（`src/exporters/css.ts:163-220`）。它做四件事：

- **flatten**：把嵌套树压成 `[path, token]` 列表（`src/exporters/css.ts:39-50`）。
- **值翻译**：dimension 的 SCALABLE 类别转 rem（除以 16，最多 5 位小数），其他转 px；duration 输出 ms；cubicBezier 对 linear 特判（`src/exporters/css.ts:90-119`）。
- **模式值**：输出 `--x-light`/`--x-dark` 两个值位，再输出一个无后缀开关变量；dark 块只换开关，不重复所有变量（`src/exporters/css.ts:180-186`、`208-211`）。
- **可访问性**：`prefers-reduced-motion` 下把 duration 压到 0.01ms、delay 归零，loop 不归零（`src/exporters/css.ts:192-198`、`214-218`）。

JSON 出口只有 36 行（`src/exporters/json.ts:29-36`），DTCG 出口 96 行（`src/exporters/dtcg.ts:82-95`）。先读 CSS，再读 DTCG，就能理解「同一棵树、不同载体」的差异。

## CLI 与 Studio 的关系

两者不是两套实现，而是同一套工具的两种外壳：

- CLI 的 `build` 命令走 `validateConfig → exportArtifacts → exportTokens`（`src/cli/commands/build.ts:30-82`）。
- Studio 的 `themeStudio` 提供 `inspect`/`preview`/`export`，内部同样调 `buildCore`/`exportTokens`（`src/studio/index.ts:82-151`）。
- `schema` 命令从 Studio 的字段定义生成，不维护第二份 schema（`src/cli/commands/schema.ts:11-50`）。

这意味着：**你在 CLI 里看到的产物，和 Studio 预览/导出的产物必须一致**。如果不一致，优先怀疑 Studio 的字段映射，而不是构建内核。

## 调试路径

遇到产物不对，按这个顺序查：

1. **先看 seed**：`resolveSeed` 的合并结果是否符合预期；`null` 是清空而不是忽略。
2. **再看树**：`buildCore().tree` 里目标节点是否存在，`$type`/`$value` 是否正确；可以用 `getNode(tree, path)`（`src/tree.ts:158-165`）。
3. **再看合同**：`kernel.json` 的 `contracts.failed` 与 `color.report`；合同失败通常比肉眼更早发现问题。
4. **最后看出口**：同一棵树换一个 exporter 是否也错；如果只有 CSS 错，问题在 `css.ts` 的值翻译或模式拆分。

这个顺序利用了「树是唯一中间表示」的优势：模型错误会影响所有出口，出口错误只影响一种格式。

## 按角色选阅读路线

不同目的的人不需要读同一批文件：

- **只想用**：读 `README.md` 的快速开始 + `src/cli/index.ts:50-86` + `src/tools/config.ts:44-131`，知道配置字段和三个命令即可。
- **想改颜色**：`src/model/color/targets.ts` → `src/model/color/math.ts` → `src/model/color/derive.ts` 的分段读法（见上节）→ `tests/core.test.ts` 的颜色相关用例。
- **想加 token**：`src/build.ts:57-94` → `src/model/skeleton.ts:58-103`（最简单的模型）→ `src/contracts.ts:159-376`（合同写法）→ `tests/core.test.ts:220-223`（默认全过）。
- **想接下游**：`src/exporters/dtcg.ts:82-95` → `src/tree.ts:18-71`（值类型）→ `src/tools/tokens.ts:26-50`（产物清单）。
- **想贡献架构**：`scripts/check-model.ts` + `rules/01-architecture.md` + `AGENTS.md`，先理解边界再动代码。

## 代码之外的元数据

仓库里还有三类容易被忽略、但对理解项目很重要的文件：

- **`llms.txt` / `skills.md` / `agent.md`**：给 AI 的索引与操作约束，说明作者把「AI 协作」当成一等公民；`AGENTS.md` 的红线与 `rules/` 的详细规范互补。
- **`DESIGN.md`**：解释数值出处，例如 100ms = 60Hz 下 6 帧、t=0.42 对齐 CSS ease-in-out、线对比度 1.16/1.45/3.0、阴影端点 8/64（`DESIGN.md:64-73`）。读模型前先读它，能少问很多「为什么是这个数」。
- **`theme.example.json` / `tokens.config.json`**：前者是带注释的默认 seed 镜像，后者是九维 subset 示例；它们不是第二真源，改默认值仍以 `src/seed.ts` 为准。

## 文件规模与阅读成本

按行数排序，仓库的重心非常集中：`src/model/color/derive.ts` 966 行，占模型层的一半以上；`src/contracts.ts` 389 行；`src/seed.ts` 297 行；`tests/core.test.ts` 283 行；`src/model/color/ramp.ts` 257 行；`src/model/light.ts` 222 行；`src/exporters/css.ts` 220 行；`src/model/color/math.ts` 202 行。其余文件大多在 100 行以下。

这意味着阅读成本不是均匀分布的：**只要拿下 `derive.ts` 的七段结构，颜色系统就懂了 70%**；`contracts.ts` 虽然长，但 133 条检查是同一个模式的重复，读 3 条就能猜出其余。真正需要逐行读的是 `derive.ts` 的求解函数与 `math.ts` 的对比度公式。

一个反直觉的事实：`src/build.ts` 只有 129 行，却是全仓库最该先读的文件。它不实现任何算法，只负责顺序与拼装；读懂它，你就知道每个模型的输入从哪来、输出到哪去。**架构的理解成本与文件行数无关，与依赖顺序有关。**

## 测试文件怎么读

5 个测试文件不是按目录镜像组织的，而是按「风险」组织：

- `tests/core.test.ts`（283 行）是主测试，覆盖确定性、几何档位、字号派生、动效、颜色面阶/色族/onSide、阴影、方向边线、solveLight、光色、合同全过、manifest 无时间戳、CSS 模式值/reduced-motion、JSON/DTCG、单位口径。它基本就是一份可执行的规格说明书，读它比读实现更快理解「系统承诺了什么」。
- `tests/cli.test.ts`（94 行）是端到端冒烟：init 生成配置、build --check 通过、schema 输出合法 JSON。它不测算法，只测命令不崩。
- `tests/tools.test.ts`（37 行）与 `tests/tools-config.test.ts`（101 行）覆盖配置校验、subset 维度、platforms 过滤、semantics 校验；这些是最容易出「用户输入错误」的地方。
- `tests/studio.test.ts`（41 行）只验证 Studio 的 inspect/preview/export 与 buildCore 同源。

读测试的顺序建议反过来：先读 `core.test.ts` 的测试名（不需要逐行看断言），建立「系统保证什么」的清单；再读 `cli.test.ts` 了解端到端边界；最后按需看工具测试。测试名就是最好的目录。

## 三个容易踩的坑

1. **改了模型却没重新生成产物**：pre-commit 会失败，但本地 `pnpm test` 不会提醒你；先跑 `pnpm build:tokens`。
2. **在 model 里 import 了 exporter**：`pnpm check` 的 check-model 会报 `model-direction`；不要用相对路径绕过，守卫会扫描所有 import。
3. **直接改 `tokens.css` 调试**：下一次构建就丢；要调样式请改 seed 或模型，再重算。
