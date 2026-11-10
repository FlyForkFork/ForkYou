# 04 · 深潜：选择管线——完整内核与定制产物如何不互相污染

**这篇回答什么问题**：0.7 为什么把“选择”和“派生”从 core 里拿出来，`selectBuild` / `deriveTree` 到底做了什么，这套设计解决了什么、又留下了什么边界。

## 1. 问题是什么

一个设计系统内核面对两种相反的需求：

- **core 要稳定**：同一个 seed 必须产出同一棵完整树；CLI、文档、合同、manifest 都依赖“274 个 token 是全集”。
- **项目要定制**：某个产品只用 `color + radius`，另一个产品只要 `motion` 的 1/3 档；某个页面要把光影从 `convex` 换成 `flat`。

0.5 的解法是让 core 接受 `tokens.subset`，在构建时裁剪。问题很快出现：**同一份 seed 在“全量构建”和“裁剪构建”下产生两棵不同的树，合同、manifest、缓存、导出全部要区分两套事实**。0.6 把它 Breaking 删除（`CHANGELOG.md:14-18`），0.7 改成“完整树 + 配置器侧过滤/派生”。

## 2. 朴素做法为什么不够

- **每个产品跑一次不同的 `buildCore`**：颜色派生 90ms 起，重复计算；更糟的是合同/计数/报告都基于不同输入，无法比较。
- **复制完整树后手删节点**：没有类型检查，容易删掉 `shadow.color` 这类非档位 token；删除逻辑散落在调用方。
- **让 core 接收 `selection`**：core 就不再是“seed 的纯函数”，`buildCore(seed)` 与 `buildCore(seed, selection)` 是两个事实来源。
- **允许用户写 recipe / 沙箱**：可复现性和安全性都会崩；这个项目明确“不支持用户 recipe”（`src/studio/derivation.ts:1-6`）。

## 3. 核心机制

### 3.1 选择模型：类别 + 档位，都是 allowlist

`SelectionConfig` 只有两个字段（`src/studio/selection.ts:31-36`）：

```ts
interface SelectionConfig {
  categories?: SelectionCategory[] // 省略 = 全部；空数组 = 不启用任何类别
  steps?: Partial<Record<SelectionStep, number[]>>
  // 省略 = 该组全量；空数组 = 去掉该组所有数字档位（保留非档位 token）
}
```

`SelectionCategory` 是 `skeleton / color / light / motion`；`SelectionStep` 是 `space / size / radius / fontSize / lineHeight / letterSpacing / shadow / occlusion / motionDuration / motionDelay / motionLoop`（`selection.ts:16-29`）。每个类别映射到树上的顶层 key（`CATEGORY_KEYS`，`:51-56`），每个档位映射到树路径（`STEP_PATHS`，`:59-71`）。

### 3.2 归一化：先把错误变成诊断

`normalizeSelection` 做四件事（`selection.ts:106-186`）：

1. 拒绝非对象 / 非数组的 shapes；
2. 未知类别、未知档位记 `selection.category.unknown` / `selection.step.unknown`；
3. 档位必须是正整数数组，否则 `selection.step.invalid`；
4. 去重后建立 `rules: Map<topKey, StepRule>`，`StepRule` 是嵌套的 `levels/groups` 结构。

注意它 **不会抛异常**：错误进入 `diagnostics`，选择结果可能为空；`selectBuild` 再把 `selection.empty` 记为 error（`:264-271`）。这是“诊断是数据”的风格，和 `planProject` 一致。

### 3.3 过滤：只动数字 key

`filterGroup`（`selection.ts:188-200`）的核心判断只有一行：

```ts
if (rule?.levels && /^\d+$/.test(key) && !rule.levels.has(Number(key))) continue
```

含义：

- 只过滤 **数字 key**（`space.1..18`、`radius.1..9`、`motion.duration.1..6`）；
- 非数字 key（`shadow.color`、`font.family`、`motion.easing`）不受档位数组影响，跟随所属类别保留；
- `levels` 为空数组时，所有数字 key 都被去掉，非档位 token 保留；
- `selectFrom` 先按 `categories` 选顶层 key，再对每个顶层节点调 `filterGroup`（`:202-210`）。

`selectTree(tree, selection)` 是纯函数（`:213-216`），不依赖 `ProjectBuild`；这使得它可以在浏览器 / 配置器里对任意树做预览，不需要构建。

### 3.4 `selectBuild`：一次构建上的过滤 + 诊断 + 产物

`selectBuild(build, selection, derivation)` 的顺序（`selection.ts:219-283`）：

1. `normalizeSelection`；
2. `deriveTree(build, derivation)` 先派生（可能替换 `highlight` / `shade`）；
3. `selectFrom` 过滤；
4. `countByCategory` 重算计数；
5. 诊断 = `build.diagnostics` 去掉 `semantics.*` + `derived.diagnostics` + `normalized.diagnostics`；
6. 若 `build.config.semantics` 存在，追加 `selection.semantics` warn（选择导出不生成 semantics.json）；
7. 检查请求的档位是否在完整树中存在，缺失记 `selection.step.missing` error；
8. 空结果记 `selection.empty` error；
9. 用 `emitTokens(..., { includeManifest: false })` 生成 CSS/JSON/DTCG，不带 `kernel.json`。

关键点：**`build.core.tree` 保持全量**，`SelectedBuild` 里另有一个 `tree`（`:38-47`、`:273-283`）。调用方要完整树时拿 `core`，要定制产物时拿 `tree` / `artifacts`，两者不混淆。

### 3.5 `deriveTree`：只调用引擎函数，不写回 seed

`DerivationConfig` 目前只有一个开关：

```ts
interface DerivationConfig {
  light?: { form?: 'flat' | 'convex' | 'concave' }
}
```

`deriveTree`（`src/studio/derivation.ts:34-89`）：

- `form` 缺省或 `convex`：原样返回 `build.core.tree`，无诊断；
- `flat` / `concave`：调 `build.core.light.solve({ form, mode: 'light' })` 和 `'dark'`，把结果写进新的 `highlight.key` / `highlight.ambient` / `shade.key`；
- 不修改 `build.core.tree`，也不修改 seed；
- 返回一条 `info` 诊断 `derivation.light.form`；
- 未知形态 / 非法形状返回 error，并保留原树。

注意 `flat` 的语义：`keyLayers` 对 `flat` 返回空数组（`src/model/light.ts:156-179`），所以 `highlight.key` / `shade.key` 的 `$value` 变成空数组，但 token 节点仍在；`highlight.ambient` 也变空（`src/model/light.ts:189`）。这不是“删除光影组”，而是“保留槽位、值为空”，符合 `DESIGN.md` 的“槽位保留、值可以缺席”。

### 3.6 studio 的缓存：只缓存 core 原版派生

`src/studio/index.ts:30-46`：

```ts
let cached: { key: string; build: ProjectBuild } | undefined
function buildFor(config) {
  const key = JSON.stringify(config.tokens)
  if (cached?.key === key) return cached.build
  const build = planProject({ tokens: { ... } })
  cached = { key, build }
  return build
}
```

缓存 key 是 `config.tokens`，**不包含 `selection` / `derivation`**；所以改选择、改光影形态不会重新跑 `buildCore`，只会重新过滤/发射。`resultFor` 只有配置了 `selection` 或 `derivation` 才调 `selectBuild`（`:54-58`）。这是 0.7 的核心性能设计，也是“选择是配置器配置”这句话的代码落点。

### 3.7 选择诊断的全集与触发条件

选择管线的错误全部走诊断，不抛异常；这一点对配置器很重要，因为用户每改一个下拉框都可能产生一个临时非法组合，抛异常会让 UI 直接崩。当前会出现的 code 有：

| code | 触发 | 级别 |
| --- | --- | --- |
| `selection.invalid` | `selection` 不是对象、`categories` 不是数组、`steps` 不是对象 | error |
| `selection.category.unknown` | 类别不在 `skeleton/color/light/motion` | error |
| `selection.step.unknown` | 档位不在 11 个 `SelectionStep` 里 | error |
| `selection.step.invalid` | 档位值不是正整数 | error |
| `selection.step.missing` | 请求的档位在完整树里不存在（如 `space: [99]`） | error |
| `selection.empty` | 过滤后没有任何 token | error |
| `selection.semantics` | 配置了 semantics，但选择产物不生成 `semantics.json` | warn |

注意 `selection.step.missing` 是在过滤之后单独扫描请求的档位得到的（`src/studio/selection.ts:246-262`），不是靠 `filterGroup` 发现——因为过滤本身只是“没有这个 key 就跳过”，不会报错。`selection.empty` 则遍历结果树计数，为 0 才报（`:264-271`）。这两条补上了“过滤是静默的”带来的可观测性缺口。

### 3.8 一个完整的调用例子

```ts
import { planProject } from '@ultime/core/tools'
import { selectBuild } from '@ultime/core/studio'

const build = planProject({ tokens: { output: 'styles' } })
const selected = selectBuild(
  build,
  { categories: ['skeleton', 'color'], steps: { space: [1, 2, 4, 6], radius: [1, 3, 5] } },
  { light: { form: 'flat' } },
)

selected.core.counts.total   // 仍是 274：完整事实
selected.counts.total        // 226：投影后的计数
selected.artifacts.length    // 3：CSS / JSON / DTCG，无 kernel
selected.diagnostics         // 含 derivation.light.form（info）
```

这段代码同时验证了三个卖点：`core` 不被污染、`counts` 按投影重算、`kernel.json` 不随选择导出。`selectBuild` 的返回类型 `SelectedBuild` 把 `core` 与 `tree/counts/artifacts/diagnostics` 并列（`selection.ts:38-47`），调用方一眼能看出哪个是全量、哪个是视图。

## 4. 代码证据

| 证据 | 说明 |
| --- | --- |
| `src/studio/selection.ts:31-71` | `SelectionConfig` / 类别 / 档位 / 树路径映射 |
| `src/studio/selection.ts:106-186` | 归一化与 5 类选择诊断 |
| `src/studio/selection.ts:188-216` | 只过滤数字 key；`selectTree` 纯函数 |
| `src/studio/selection.ts:219-283` | `selectBuild` 完整流程，`core.tree` 保持全量 |
| `src/studio/derivation.ts:34-89` | `deriveTree` 只重算 highlight/shade，不写回 seed |
| `src/studio/index.ts:30-58` | 单槽缓存 key 排除 selection/derivation |
| `src/model/light.ts:156-195` | `keyLayers` 对 flat 返回空；`solve` 的 form/depth/mode 闭包 |
| `src/tools/tokens.ts:34-47` | `includeManifest: false` 时不生成 kernel.json |

## 5. 复杂度、性能与边界条件

- **`selectTree` 是 O(n)**：遍历一次完整树。本机实测 `selectTree(color)` 1000 次 27.8ms（约 0.028ms/次），因为 274 个 token 很小。
- **`selectBuild` 的主要成本是发射产物**：默认构建下，选择 `skeleton+color` 且裁剪 space/radius 后 total 226，产物 CSS 56,465B / JSON 28,035B / DTCG 161,009B（`_cache/tmp/probe-perf.mjs`）。
- **`buildCore` 仍是 90ms 量级**：选择不重新派生，所以切换选择只付过滤 + 发射成本；这是 0.7 缓存设计的收益。但 `emitTokens` 会先构造三份完整字符串再按平台过滤（`src/tools/tokens.ts:35-46`），即使只要 CSS 也会算 JSON/DTCG；这是当前的实现成本，不是架构必然。
- **单槽缓存**：`cached` 只有一个 key；在两个配置之间来回切（A → B → A）会每次都重新 `buildCore`。对单配置器够用，对多租户/批量生成不够。
- **`bytes` 计算**：`selectBuild` 用 `TextEncoder` 对每个产物重新编码（`selection.ts:87`、`:274-281`），与 `planProject` 的 `bytes` 计算重复；大产物下是常数级额外成本。
- **边界**：`selectTree` 未知类别/档位被忽略但不报错（诊断只在 `selectBuild` 里有）；直接调 `selectTree` 做 UI 预览时要自己处理错误。

## 6. 取舍与局限

1. **选择是 allowlist，不是变换**：不能重命名、不能改值、不能新增 token；这些属于“派生”，不属于“选择”。这是有意的边界，避免选择器变成第二套模型。
2. **只认数字 key**：树里如果有非数字的档位命名（例如 `radius.sm`），无法按档位过滤；当前模型全部用序号，所以成立。
3. **派生只有 `light.form`**：`deriveTree` 不支持 depth、mode、颜色参数、用户 recipe（`derivation.ts:12-17`）；新增派生必须加引擎函数，不能在配置里写公式。
4. **`flat` 不删组**：只把值清空，`highlight` / `shade` token 仍在；如果下游按 token 存在性判断“有没有光影”，会误判。
5. **`selection` 不进入 CLI 配置**：CLI 只读 `tokens` 区，选择/派生另存 studio 配置（`README.md:104`）；这意味着 CLI 用户无法直接复现 studio 的定制产物，需要调用 `@ultime/core/studio` API。
6. **共享子树**：`deriveTree` 只浅拷贝顶层，并替换 `highlight` / `shade`；其他组与 `build.core.tree` 共享引用（`derivation.ts:68-77`）。推断：调用方应把它当不可变数据，否则可能污染基线。
7. **缓存不是并发安全**：单槽模块级变量，多请求并发时会互相覆盖；服务端复用需要外部缓存或每次新建构建。

## 7. 我能偷什么

- **把“全集”和“视图”分开**：core 永远产完整事实，选择器只做过滤；这比让核心接受各种 `subset` 参数更稳定。
- **选择配置用 allowlist + 空数组语义**：空数组 = 去掉该组数字档位，非档位 token 保留；规则简单、可预测、易序列化。
- **派生只包装引擎函数**：配置里只放 `form: 'flat' | 'concave'`，实际计算仍走 `solveLight`；不开放用户公式，保住可复现性。
- **缓存 key 只包含会触发重新派生的部分**：`JSON.stringify(config.tokens)` 不含 selection/derivation；这是“改视图不重算模型”的最短实现。
- **诊断分层**：未知类别 / 缺失档位 / 空结果都是 error，但 semantics 只 warn；配置器可以逐条显示，不会因为一个 warn 阻断预览。

**一句话记住**：完整树是事实，选择是视图，派生是引擎函数的参数化调用；三者分开，才能既不改 core 又让每个产品拿到自己的 token 集。
