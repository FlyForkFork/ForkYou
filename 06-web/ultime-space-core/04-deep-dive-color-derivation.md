# 04 · 深挖：颜色是怎么从 seed 推出来的

> 结论先行：`@ultime/core` 的颜色系统不是「选色板」，而是一组**对比度约束求解器**。seed 只给色相、识别预算、画布档位、面目标与前景阈值；OKLCH 负责在 sRGB 色域内生成可用的色，WCAG 对比度负责反解明度与覆盖度，最终 194 个颜色 token 全部由这两类计算推出（`kernel.json` 的 counts）。

## 问题：为什么不能直接存一张色板

一套完整颜色系统远不止 12 个主色。以本项目产物为例，颜色类别有 194 个 token：每个语义色族有 solid/soft/bare 三种形态，solid 与 soft 各含 fill/ink/line，bare 只有 ink/line，fill 又有 8 个交互状态；表面有 card/overlay/sunken，墨有四级，线有三档，另有 scrim、shadow ink。手写会带来三个问题：

1. **一致性靠人**：改了主色，浅色 soft、深色 soft、边框、文字、hover 必须同步，漏一个就出现「按钮和边框不是一个品牌」。
2. **对比度不可证**：设计师目测「这个灰够深」，但 4.5:1 是算出来的，不是看出来的。
3. **无法响应 seed**：换一个 primaryHue，整棵树要重做；而 seed 驱动的系统应该只需要改一个数字。

所以项目选择「派生优先」：能由 seed 算出的值，不写第二份名单（`DESIGN.md:32-44`）。

## 朴素做法为什么不够

常见替代是「HSL 调明度」：主色 `hsl(h, s%, l%)`，hover 减 8% 明度，pressed 再减 8%，文字用白色或黑色。它有三个硬伤：

- **HSL 的明度不是感知明度**：同一 L 值的黄和蓝，感知亮度差很远；WCAG 对比度算的是相对亮度，HSL 调出来的 4.5 经常不达标。
- **sRGB 色域边界不均匀**：高 chroma 的蓝色在 L 很低时才进色域，直接乘系数会溢出成不可显示的颜色。
- **状态没有目标**：hover 到底该比 rest 亮多少？没有阈值就无法验收，也无法在 seed 改变后重新保证。

本项目的答案是：**在 OKLCH 里做色相与 chroma，在 WCAG 相对亮度里解明度，在 sRGB 里检查色域**。三个空间各管一件事。

## 核心机制

### 1. OKLCH 负责「色相正确、色域合法」

seed 的主色是 HSL（`primaryHue/lightness/chromaRatio`，`src/seed.ts:26-37`），先转成 OKLCH。`toOklch` 把 OKLab 的 L 映射成 0–100 的 tone（`src/model/color/oklch.ts:64-70`）；`chromaMax` 用 20 次二分找到当前色相与明度下 sRGB 能容纳的最大 chroma（`src/model/color/oklch.ts:73-86`）；`fromOklch` 生成最终 hex 前先把 chroma 夹到边界内（`src/model/color/oklch.ts:88-94`）。这保证任何 seed 都不会产出越界颜色。

### 2. 中性灰：配方 + 色调曲线 + 画布对称

中性色不是简单的一条灰阶。`NEUTRAL_RECIPES` 定义了 5 套明暗色温配方（neutral/paper-night/same-warm/cool/sepia，`src/model/color/ramp.ts:50-71`），`DEFAULT_TONE_CURVE` 给出 12 档 tone 基准（`src/model/color/ramp.ts:16`）。`neutralRamp` 先校验曲线严格递减，再按 `hueShift` 做色相旋转（`src/model/color/ramp.ts:137-161`）。

画布对称是这里最巧的一步：`symmetricCanvasCurve` 让浅色画布的 100 档对白、深色画布的 950 档对黑取得**同一个对比度 k**（默认 1.2），其余档位保持原有对比关系并强制递减（`src/model/color/ramp.ts:200-226`）。它的意义是：light/dark 两套画布在视觉上「一样深」，而不是各调各的。

### 3. 语义色族：先解填充，再派生整个家族

`deriveColor` 对每个语义色调用 `deriveAccentFamily`（`src/model/color/derive.ts:267-316`）。关键在 `solveFillTone`：给定色相、chroma 与目标对比度，从白（tone 100）或黑（tone 0）开始，以 0.5 tone 为步长扫最多 201 个采样点，找到第一个既满足对比度又最接近偏好锚点的填充色（`src/model/color/derive.ts:91-122`）。浅色文字从 100 往下找，深色文字从 0 往上找；`preferredTone` 用于把结果拉回设计想要的明度区间。

拿到 base 后，`familyParts` 按固定配方派生：浅色 soft 是 base 与白 92% 混合，边框通过 `mixForContrast` 找最接近 1.38 的混合比例，文字通过 `textOn` 解到 6:1；深色 soft 改为与黑 72% 混合（`src/model/color/derive.ts:190-222`）。状态则由 `stateSteps` 控制：hover/pressed 相对 base 提亮或压暗固定档位（`src/model/color/derive.ts:224-265`）。所以一个语义色最终会展开成 solid/soft 的 fill/ink/line 矩阵加 bare 的 ink/line（`src/model/color/derive.ts:416-471`）。

### 4. 面阶、墨、线：把「看起来该有多深」变成覆盖度

表面（card/overlay/sunken）用 `faceContrast` 作为目标，例如 card=1.1、overlay=1.14、sunken=1.07（`src/seed.ts:52-66`）。`solveCoverage` 以 0.002 为步长线性扫描，找一层黑色或主色 tint 叠在画布上的最小覆盖度，使结果与画布的对比度恰好达到目标（`src/model/color/math.ts:194-202`）。深色模式则自动改用黑色叠加，因为 tint 在深底上方向相反。

墨（ink）不是独立色板：它以主色为基，按 primary .65 / secondary .55 / tertiary .45 / disabled .35 的 alpha 起步，然后对四个面分别算 `solveAlpha`，取其中最大的 alpha，保证在任何面上都达标（`src/model/color/derive.ts:636-664`）。`solveAlpha` 每次加 0.005，直到对比度超过目标 +0.03 的余量（`src/model/color/math.ts:183-191`）。

线（line）同理，但目标是对画布的覆盖度：三档分别对应 1.16、1.45、3.0 的对比度（`src/model/color/targets.ts:8`），`solveCoverage` 反解出黑色或白色线的 alpha（`src/model/color/derive.ts:666-683`）。状态色（hover/pressed/disabled）也用同一套覆盖度求解（`src/model/color/derive.ts:685-706`）。

### 5. 阴影墨：只留一种墨，色相可以借环境

阴影如果每种颜色一条，很快会失控。项目让 shadow/scrim/shade 共用同一枚墨：tone 取 `min(22, 画布tone−12, 深画布tone−6)`，chroma 封顶 0.02，色相与 chroma 可由环境色注入（`src/model/color/derive.ts:708-722`）。合同 `single-ink` 会检查三处 hex 是否一致（`src/contracts.ts:337-351`），从结构上禁止「阴影偏蓝、遮罩偏紫」。

## 代码证据

1. **色域边界**：`src/model/color/oklch.ts:73-86`，20 次二分求当前色相/明度的最大 chroma，避免 sRGB 溢出。
2. **填充反解**：`src/model/color/derive.ts:91-122`，0.5 tone 步长、201 个采样点，按 solidTarget 找可行填充色。
3. **家族配方**：`src/model/color/derive.ts:190-222`，soft/border/text 的混合比例与 1.38/6.0 目标集中在一处。
4. **画布对称**：`src/model/color/ramp.ts:200-226`，两套画布对极值取同一对比度 k，其余档保持相对关系。
5. **覆盖度反解**：`src/model/color/math.ts:194-202`，步长 0.002，向上取到 0.002 的整数倍。
6. **墨的跨面保证**：`src/model/color/derive.ts:636-664`，对四个面分别求 alpha 后取最大值。
7. **合同同源**：`src/model/color/targets.ts:8-26` 的 LINE/SURFACE/STATE/INK/TONE 目标同时被派生与合同使用，避免「算一套、验一套」。

## 复杂度与边界

- **时间复杂度**：每个色族一次 `solveFillTone`（最多 200 次 tone 采样，每次一次 OKLCH→sRGB 转换与对比度计算），每个面/线/状态一次 `solveCoverage`（最多约 500 次）。全部颜色构建是毫秒级常量开销，不随 token 数增长。
- **空间**：只保留 seed、中性 ramp 与最终树，中间候选不缓存；确定性构建不依赖任何全局状态。
- **边界一：WCAG 2.x 而非 APCA**。`contrast` 用 sRGB 相对亮度公式（`src/model/color/math.ts:104-112`），对深色模式与细字重的感知偏差没有建模。项目也没有声称支持 APCA。
- **边界二：只做 sRGB**。`ColorValue` 固定 `colorSpace:'srgb'`（`src/tree.ts:41-46`），P3/Display-P3 不在范围内。
- **边界三：目标可能不可达**。当某个色相在 sRGB 内无法同时满足 chroma 与对比度时，报告会记 warn 而不是让构建失败；`contrastAllow` 白名单进一步把已知偏差降级（`src/model/color/derive.ts:939-945`）。这是有意的：颜色是设计问题，不该阻断整棵树的构建。

## 取舍

**用固定配方换可预测性**。soft 与白的混合比例、hover 的步长都是常量，而不是让模型自由发挥；好处是同一 seed 永远得到同一结果，代价是某些品牌可能需要额外 override。项目把 override 留在上层（`semantics` 只写路径，不写值，`src/tools/semantics.ts:37-76`），内核保持纯粹。

**用报告换阻断**。颜色对比度不阻断构建，只在 `kernel.json` 里留下 106 条 level 记录；结构合同（字号递增、圆角派生、单墨等）才阻断。这个分层值得借鉴：**能用数学保证的做强约束，需要审美判断的做弱提醒**。

## 可迁移的三件事

1. **把设计目标写成阈值，而不是值**：`faceContrast.card=1.1` 比 `surface.card=#f7f7f7` 更能适应品牌色变化。
2. **在正确的色彩空间做正确的事**：OKLCH 管色相/chroma，WCAG 管明度，sRGB 管色域；不要用一个 HSL 公式包打天下。
3. **派生与验收共用一份目标常量**：`targets.ts` 同时被 `derive.ts` 和 `contracts.ts` 引用，避免两套数字漂移；这是比「写更多测试」更便宜的一致性保障。
