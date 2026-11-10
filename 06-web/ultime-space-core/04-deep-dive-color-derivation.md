# 04 · 深潜：颜色派生——用 OKLCH 和 WCAG 反解 194 个颜色 token

**这篇回答什么问题**：为什么这个项目能从 5 个色相和一组对比度目标生成 194 个颜色 token，它到底在哪个色彩空间里算，哪些目标能保证、哪些只能报告。

## 1. 问题是什么

默认 seed 下，树里有 194 个颜色 token，分布在：

- `surface`：canvas / raised / overlay / inset / block{weak,base,strong}；
- `ink`：primary / secondary / tertiary / disabled；
- `line`：1 / 2 / 3；
- `tone`：primary + danger/warning/success/info 五个族，每族 `solid` / `soft` / `bare` 三套，每套又有 fill / ink / line 与状态；
- `state`：hover / pressed / disabled / selected；
- `scrim`：单值半透明阴影色。

困难不是“生成 194 个名字”，而是：**改一个 primaryHue 或画布亮度，194 个值里的每一对前景/背景仍然要满足既定的对比度目标，且两组模式都要成立**。手写色板做不到，因为人眼估计的“深一点”不是对比度。

## 2. 朴素做法为什么不够

- **手选色板**：每个色相手填 10 档，改品牌色要重填 5 个族 × 2 模式 × 多状态；同一事实有多份名单。
- **在 HSL 里调 L**：HSL 的 `L=50%` 对黄色和蓝色看起来完全不是一个亮度；用它反解对比度会在黄色上过亮、蓝色上过暗。
- **在 sRGB 里直接混白/黑**：混出的中间色会发灰、色相漂移；而且混完再检查对比度，只能“事后补救”，不能保证最小改动。
- **先做 token 再跑 contrast 测试**：测试只能告诉你“这组不达标”，不能告诉你“最接近达标的那个值是多少”。这个项目要的是后者。

## 3. 核心机制

### 3.1 在 OKLCH 里定 tone，在 sRGB 里交付

主色 seed 是 HSL 的 `primaryHue / lightness`，先转成 RGB，再 `toOklch` 得到感知明度 `tone = L × 100` 与 hue（`src/model/color/derive.ts:480-482`）。`toneColor(tone, hue, chromaRatio)` 不直接把 chroma 写死，而是调 `chromaMax(tone, hue)` 求该 tone/hue 在 sRGB 内的最大 chroma，再乘系数（`src/model/color/derive.ts:50-53`）。

`chromaMax` 是一次 20 步二分：上界 0.4，若 0.4 已经在色域内就直接返回，否则不断缩到边界（`src/model/color/oklch.ts:72-86`）。`fromOklch` 最后把 chroma 夹到 `[0, 0.4]` 并转回 sRGB hex（`:88-93`）。因此产物里不会出现 `oklch()` 字面量，只有 sRGB hex / rgba；OKLCH 只是计算空间。

### 3.2 填充色：从极点向中间扫，找第一个达标值

`solveFillTone` 是颜色族的起点（`src/model/color/derive.ts:91-122`）：

- `onSide = 'light'` 表示浅色文字，从 `tone=100`（白）往暗扫；`'dark'` 从 `tone=0`（黑）往亮扫；
- 每步 0.5 tone，共 201 步（`i = 0..200`）；
- 第一个满足 `contrast(onColor, hex) >= target` 的 tone 就是可行域边界 `limit`；
- 如果给了 `preferredTone`（主色锚点或语义色 60），取“可行域内离锚点最近”的值：浅色侧 `min(preferredTone, limit)`，深色侧 `max(preferredTone, limit)`（`:119-121`）。

这解释了一个容易误解的点：**基础色不是“选出来的”，是“能达标的最亮/最暗值”，再被偏好 tone 拉回可行域内**。

### 3.3 色族：从基色派生软底、边框、文字与状态

`FAMILY_RECIPE`（`src/model/color/derive.ts:128-142`）是一组手调比例：

- 浅色 `soft = mixWhite(base, 0.92)`，深色 `soft = mixBlack(base, 0.72)`；
- `border = mixForContrast(base, soft, 1.38)`；
- `text = textOn(base, soft, 6.0)`；
- `textWeak` 对 soft 解 5.0，`textStrong` 解 7.2（`:190-222`）；
- hover / active 用 `stateSteps`（默认 [3,6]）从 base 的 tone 往方向推（`deriveFamilyMode`，`:248-264`）。

`deriveAccentFamily`（`:267-315`）还处理 hue：

- `pullHue(anchor.hue, themeHue, pull, identityBudget)` 用最短弧把语义色向主色拉，默认 `pull=1`、`identityBudget=2`，即最多让 2°（`FAMILY_RECIPE` 之外的 accent 参数在 `src/seed.ts:146-152`）；
- `anchorMax = chromaMax(anchor.tone, anchor.hue)`，`baseChroma = chromaRatio × anchorMax`，再夹 `chromaFloor`；
- 主色 `chromaRatio=0` 时根本不走 accent 分支，而是 `inkFamily`：主色族直接取中性灰阶最深/最浅档（`src/model/color/derive.ts:544-561`）。这是“默认主色是墨色”的实现，不是营销语。

语义色固定 `chromaRatio = 0.9`、`preferredTone = 60`（`:565-581`）；色相仍可在 seed 里按数字给（`danger: 0` 等，`src/seed.ts:134`）。

### 3.4 面阶与控件底：反解覆盖度，不写死 alpha

面阶从 `surface.faceContrast` 的目标出发：card 1.1、overlay 1.14、sunken 1.07（`src/seed.ts:159`）。`solveCoverage` 以 0.002 步长找最小 alpha，使 tint 叠在 canvas 上的合成色达到目标，返回时向上取到 1/500（`src/model/color/math.ts:193-202`）。

`controlBg` 是 tint 以 card alpha 叠在 canvas 上的实际控件面（`src/model/color/derive.ts:606-607`），后续 `strong` 色对控件面解 3:1（`:609-613`）。

### 3.5 中性灰阶：Tone 曲线与画布对称

所有颜色都站在 12 档中性灰阶上（`NEUTRAL_STEPS = [50,100,150,200,300,400,500,600,700,800,900,950]`，`src/model/color/ramp.ts:13`）。每一档的 tone 来自 `DEFAULT_TONE_CURVE [98.5,97,95.5,93.5,89.5,84,76,65,54.5,43,32,26]`（`:16`），必须严格递减，否则 `neutralRamp` 直接抛错（`:137-161`）——这是“配方表也是合同”的一个小例子。

配方不是一套：`NEUTRAL_RECIPES` 有 `neutral / paper-night / same-warm / cool / sepia` 五套，`NEUTRAL_TEMPERATURES` 有 `neutral / warm / cool` 三套（`:50-88`）。每套配方给 hue、chroma、chromaShare 等参数，`resolveNeutral` 再把 seed 的 `neutral.preset` 与 `fromTheme` 合并（`:101-134`）。

画布对称是这里最特别的设计：`surface.canvasSymmetry` 只允许配 `neutral.*` 画布，否则抛错（`src/model/color/derive.ts:489-495`）；`symmetricCanvasCurve` 会重排 12 档 tone，使画布两端对白/黑的对比度相同（同一个 k），其余档按原对比度比例重映射，最后保证每档至少递增 0.05（`ramp.ts:200-226`）。默认 `1.2` 表示浅色画布比“对称”再亮一点；这解释了为什么默认 `neutral.100` 不是死板的 97，而是被曲线重新解出来的值。

`stepRatio` 控制档差：`functional` 保持原曲线；`band-geo` 把 12 档分成 4+6 段；`band-geo-3` 分成 3 段，并用 `LINE_TARGETS` 1/2 档的对数差来分配（`ramp.ts:232-257`、`:95-96`）。这让“灰阶要密一点还是疏一点”成为 seed 的一个枚举，而不是重画一张表。

### 3.6 墨、线、状态、阴影墨

- **墨**：基础 alpha 是 primary .65 / secondary .55 / tertiary .45 / disabled .35；对四个面（canvas、controlBg、overlay、inset）分别用 `solveAlpha` 求 alpha，取最大值（`src/model/color/derive.ts:636-664`）。`solveAlpha` 以 0.005 步长，目标加 0.03 余量吸收 hex 取整（`src/model/color/math.ts:179-191`）。
- **线**：对 canvas 解 1.16 / 1.45 / 3.0 三档覆盖度（`src/model/color/derive.ts:666-683`、`targets.ts:7-8`）。
- **状态**：hover 1.08 / pressed 1.12 / disabled 1.03，由 canvas 反解；selected 是主色 8% alpha（`src/model/color/derive.ts:685-706`、`targets.ts:13-14`）。
- **阴影墨**：`tone = min(22, lightTone−12, darkTone−6)`，chroma 上限 0.02，hue 可借 `ambientColor`（`src/model/color/derive.ts:708-722`）。这一枚墨同时给 shadow / occlusion / scrim / shade.key，合同 `single-ink` 会检查（`src/contracts.ts:337-351`）。

### 3.7 报告：106 条颜色记录

`deriveColor` 返回的 `report` 在默认 seed 下有 106 条 `pass`（`kernel.json` 的 `color.levels`）。报告覆盖：面阶、线、墨对四个面、每族软底文字/弱/强/前景/边框/强线、色相分离、不可达填充、端点偏离（`src/model/color/derive.ts:724-945`）。这些记录不是“测试失败项”，而是 **设计系统的体检表**：`level` 只有 pass / warn / deviation / unverified，`auditContracts` 把它们转成非阻断合同行。

### 3.8 报告行为什么这样命名

报告行的 `id` 不是随意起的，而是“位置 + 角色”的压缩：`surface-target` / `line-target` / `ink-contrast` 描述面与线的目标；`tone-text` / `tone-text-weak` / `tone-text-strong` 描述色族文字的三个对比档；`tone-border` / `tone-strong` 描述边框与强线；`tone-fill-unreachable` 是失败态；`foreground-endpoint` 是实心面前景的端点检查；`hue-separation` 只在有 chroma 时出现。读报告时先按前缀分组，再看 `level`，比逐行读 106 条高效得多。

这些行同时也是 `auditContracts` 的输入：`colorRows` 把每条 `level` 映射成合同行，`blocking: false`（`src/contracts.ts:144-156`）。因此“报告”和“合同”不是两套数据，而是同一份体检表的两种视图；`manifest.color.report` 保留完整明细，`manifest.contracts` 只保留计数和 id 摘要。

## 4. 代码证据

| 证据 | 说明 |
| --- | --- |
| `src/model/color/targets.ts:7-26` | 线 / 面 / 状态 / 墨 / 浅底 / 前景的全部目标值，派生与合同共用 |
| `src/model/color/oklch.ts:72-93` | `chromaMax` 20 步二分；`fromOklch` 夹色域后转 sRGB |
| `src/model/color/math.ts:114-202` | 24 步 HSL 明度二分、`solveAlpha` 0.005 步长 + 0.03 余量、`solveCoverage` 0.002 步长 |
| `src/model/color/derive.ts:91-122` | `solveFillTone` 201 步扫描 + 偏好 tone 夹取 |
| `src/model/color/derive.ts:128-222` | `FAMILY_RECIPE` 与软底/边框/文字/弱强档 |
| `src/model/color/derive.ts:584-722` | 面阶、控件底、墨、线、状态、阴影墨的完整顺序 |
| `src/model/color/derive.ts:916-945` | 报告行、`hue-separation`、`tone-fill-unreachable`、`contrastAllow` |
| `src/contracts.ts:144-156` | 颜色报告转合同行，统一 `blocking: false` |

## 5. 复杂度、性能与边界条件

- **扫描量**：`solveFillTone` 最坏 201 次 `toneColor`；每个 `toneColor` 要一次 `chromaMax`（最坏 20 次 `oklabToSrgb01`）。默认 5 个族 × 2 模式 ≈ 10 次 `solveFillTone`，即约 2,010 次 `toneColor`、40,200 次色域检查。
- **二次反解**：`weakTone` / `strongTone` 每个模式各 24 步 HSL 二分或最多 50 步 2% 混合（`derive.ts:172-187`）；墨的 4 档 × 4 个面 × 最多 200 步 `solveAlpha`；线的 3 档 × 2 模式 × `solveCoverage`。
- **时间**：本机 Node 24 实测 `buildCore` 平均 90.54ms、p50 82.27ms、p95 160.81ms（`_cache/tmp/probe-perf.mjs`，非官方 benchmark）。颜色是主要成本，空间/动效可以忽略。
- **边界 1：目标不可达**。`solveFillTone` 返回 `null` 时，`deriveFamilyMode` 回退到极点 tone（浅色 0 / 深色 100）并记录 `tone-fill-unreachable` deviation（`derive.ts:243-247`、`:903-917`）。构建不会失败，需要读报告。
- **边界 2：固定步长**。tone 以 0.5 为步长、alpha 以 0.005 / 0.002 为步长，结果是“网格上的最优”，不是连续最优；精度足够，但不是数学极值。
- **边界 3：WCAG 2.x 不是 APCA**。`contrast` 用 sRGB 相对亮度公式（`math.ts:102-112`），不是 APCA；对大字、细字、不同字重的感知差异没有建模。
- **边界 4：只保证 sRGB**。`chromaMax` 的色域是 sRGB；没有 Display P3 / Rec.2020 目标。
- **边界 5：`contrastAllow` 是逃生口**。它只把 `deviation` 降为 `warn`，不改变实际值（`derive.ts:939-945`）；滥用会让报告失真。

## 6. 取舍与局限

1. **色相不是自由的**：语义色会被主色拉近最多 `identityBudget=2°`（`derive.ts:44-47`），主色 hue 会改变 danger/warning 的实际色相；如果品牌要求语义色绝对固定，需要把 `pull` 设为 0（推断：当前 seed 类型允许传 `accent.pull`，但默认 1）。
2. **主色默认是墨色**：`chromaRatio=0` 时 `primary` 走 `inkFamily`，不是“蓝色主色”；要品牌色必须显式给 `chromaRatio > 0`（`src/seed.ts:140`）。
3. **颜色合同不阻断**：默认构建 `failed=0`，但 `color.levels` 里仍可能有 warn/deviation；发布门禁要单独读 `manifest.color`。
4. **报告不是全覆盖**：它只登记被显式 push 的配对，不做“所有前景 × 所有背景”的笛卡尔积；未登记的配对即使不达标也不会出现。
5. **性能换来了简单**：没有缓存 `chromaMax` / `solveAlpha`，重复调用多；换来的是无状态、可复现、易调试。对 274 token 的构建可接受，对上千 token 的规模需要 memo。

## 7. 我能偷什么

- **目标与派生共用一份常量**：`targets.ts` 同时被 `derive` 和 `contracts` 引用，改目标只改一处，验收不会拿另一套数字。
- **在感知空间求明度，在交付空间验对比度**：OKLCH 负责“看起来均匀”，WCAG 负责“可读”，两者不要混为一个公式。
- **反解最小改动而不是重填整张表**：`solveCoverage` / `solveAlpha` 都返回“刚好达标的最小值”，这样改 seed 时色板整体移动最小。
- **把不可达显式记录下来**：返回 `null` 不如返回 `null + report row`；设计系统需要知道“这个目标在当前色域做不到”，而不是悄悄给个近似值。
- **颜色报告分级**：结构错误阻断、颜色偏差报告；这比“全绿才发布”更适合设计系统。

**一句话记住**：颜色不是选出来的，是在 OKLCH 里沿感知明度轴找到的、刚好满足 WCAG 目标的最小改动值；报告负责告诉你哪些目标在 sRGB 里根本达不到。
