# 05 · 性能：274 个 token 背后的数万次颜色采样

**这篇回答什么问题**：这个项目的性能花在哪里、复杂度是什么量级、有没有官方 benchmark、哪些优化值得做、哪些不值得。

## 性能敏感路径清单

| 路径 | 做什么 | 量级 |
| --- | --- | --- |
| `deriveColor` | OKLCH 色域二分、填充 tone 扫描、alpha/coverage 反解 | 构建的绝对大头 |
| `auditContracts` | 3 次全树 walk + 133 行合同生成 | 常数级，远小于颜色 |
| `treeToCss` | 深度优先 flatten + 字符串拼接 | O(tokens)，输出 59KB |
| `treeToJson` / `treeToDtcg` | 递归 map + `JSON.stringify` | O(tokens)，DTCG 186KB |
| `selectTree` | 单次遍历过滤 | O(tokens)，微秒级 |
| `selectBuild` | 过滤 + 重新发射三份产物 | 发射成本，不含重新派生 |
| `check-model.ts` | 静态扫源码 + 构建默认树一次 | 只在 `pnpm check` 跑 |

## 复杂度

- **时间**：`buildCore` 近似 `O(族数 × 模式数 × 反解步数 + token 数)`；token 数只有 274，颜色反解是主导项。
- **空间**：`O(token 数 + 输出字符串大小)`；树本身很小，主要内存是 DTCG 字符串（186KB 量级）。
- **合同**：`semanticNodes` / `modeCompleteness` / `carrierSyntax` 各一次全树遍历，`countByCategory` 再一次；相对颜色可忽略。
- **选择**：`selectTree` O(n)；`selectBuild` 额外 `emitTokens`，输出大小随选择结果线性下降。

## 关键常量与阈值

| 常量 | 值 | 位置 |
| --- | --- | --- |
| 填充 tone 扫描 | 0.5 步长，201 步 | `src/model/color/derive.ts:110-117` |
| 色域二分 | 20 次，上界 0.4 | `src/model/color/oklch.ts:72-86` |
| 明度二分 | 24 次 | `src/model/color/math.ts:133-168` |
| alpha 反解 | 0.005 步长，目标 +0.03 | `src/model/color/math.ts:183-191` |
| coverage 反解 | 0.002 步长 | `src/model/color/math.ts:194-202` |
| 强档混合 | 最多 50 次，每次 2% | `src/model/color/derive.ts:180-187` |
| 合同行 | 133 行 / 34 类 | `src/contracts.ts:159-375` |

## 本机实测

项目没有官方 benchmark，也没有性能测试脚本。以下数字来自本机探针（Node v24.13.1，Windows，`_cache/tmp/probe-perf.mjs`，通过自写 ESM resolve hook + Node type stripping 直接 import `src/`，不是打包后的 dist）：

```bash
node --import ./_cache/tmp/ts-resolve.mjs _cache/tmp/probe-perf.mjs
```

| 指标 | 结果 |
| --- | --- |
| `buildCore` 100 次 | avg 90.54ms / p50 82.27ms / p95 160.81ms |
| `selectTree` 1000 次（color） | 27.8ms（约 0.028ms/次） |
| `treeToCss` | 59,587B / 924 行 |
| `treeToJson`（内存） | 30,202B（磁盘文件 30,203B，含结尾换行） |
| `treeToDtcg`（内存） | 179,457B（磁盘 186,385B，含格式化差异） |
| 四份产物合计 | 318,627B（CSS 59,587 + JSON 30,203 + DTCG 186,385 + kernel 42,452） |

选择裁剪的实测：`selectBuild({categories:['skeleton','color'], steps:{space:[1,2,4,6], radius:[1,3,5]}})` 得到 226 个 token，产物 CSS 56,465B / JSON 28,035B / DTCG 161,009B，且不含 `kernel.json`。

**注意**：这是单机、单次、未做 warm-up 隔离的测量；p95 160.81ms 说明有明显的 GC/首次 JIT 波动。不能当作 CI 性能门禁的基线。

## 测量方法与误差

项目没有官方 benchmark。上面的数字来自一份临时探针（`_cache/tmp/probe-perf.mjs`），通过自写的 ESM resolve hook 直接 import `src/*.ts`，运行在 Node v24.13.1 / Windows。这带来三个误差来源：

1. **没有 warm-up 隔离**：100 次里包含 JIT 预热，p95 160.81ms 明显高于 p50 82.27ms，说明前几次和 GC 峰值拉高了尾部；
2. **不是打包产物**：直接跑 TypeScript 源码 + Node type stripping，和 `dist/*.js` 的 V8 优化路径不同；
3. **单机单次**：没有跨机器、跨 Node 版本对比，不能当 CI 基线。

因此这些数字的用途只有一个：判断“90ms 量级是否可接受”，不是承诺。要把它变成工程指标，至少需要固定 Node 版本、预热 20 次、取 200 次中位数，并在 CI 里存历史曲线。

## 90ms 大概花在哪（推断）

仓库没有 phase-level profiler，以下按代码路径推断，未实测：

- **颜色派生**：绝对大头。`solveFillTone` 每个族 × 模式最多 201 步，每步 `toneColor` 里一次 `chromaMax`（最多 20 次色域检查），5 个族 × 2 模式就是数万次 sRGB 转换；再叠加墨的 4×4 面 × `solveAlpha` 和线的 `solveCoverage`。
- **中性灰阶**：`neutralRamps` 对每档做 `solveToneFor`（50 次二分），12 档 × 2 模式，量级远小于色族。
- **光影**：4 档 shadow + 4 档 occlusion，纯算术，可忽略。
- **合同与序列化**：合同是几次全树遍历；CSS/JSON/DTCG 是字符串拼接，相对颜色可忽略。真正的 186KB DTCG 字符串构造会占几毫秒，但不是主因。

一个可验证的旁证：`selectBuild`（不含 `buildCore`）的主要成本是发射产物，而 `selectTree` 1000 次只要 27.8ms；这说明树遍历/过滤是微秒级，90ms 不可能来自树操作。

## 规模外推

| 场景 | token 量 | 预计 `buildCore` | 依据 |
| --- | --- | --- | --- |
| 默认 seed | 274 | ~90ms（实测） | 5 族 × 2 模式 |
| 加 2 个语义族 | ~350 | ~120ms（推断） | 族数线性增加 `solveFillTone` |
| 加 10 个品牌族 | ~700 | ~300ms（推断） | 每族独立扫描，无跨族缓存 |
| token 翻 10 倍但族数不变 | ~2740 | 仍 ~90ms（推断） | 颜色由族数决定，树遍历线性但基数小 |

结论：**性能由“族数 × 模式数 × 反解步数”决定，不由 token 叶子数决定**。如果只是把 spacing 从 18 档扩到 100 档，构建几乎不变；如果把语义色从 4 个扩到 40 个，构建会线性变慢。

## 与替代实现比较

- **解析解**：理论上可以把 `solveFillTone` 变成闭式解，但 WCAG 相对亮度是分段函数、sRGB 色域边界是非线性的、tone 还要落在 0.5 网格上；三条约束叠在一起，解析解的分支比扫描多得多。当前选择是“用 201 次采样换 100 行可读代码”。
- **查表/缓存**：`chromaMax(tone, hue)` 的结果只依赖 tone/hue，可在进程内 memo；代价是缓存失效与内存。对 274 token 的构建，90ms 不值得引入状态。
- **并行**：`buildCore` 是纯函数，理论上可按族并行；但 Node 单线程 + 结构化克隆的成本会让 5 个族的并行收益很小，当前没有 worker。

## 优化手法（已存在的）

1. **一次构建，多处消费**：`planProject` 只调一次 `buildCore`，CLI / studio / scripts 共享（`src/tools/project.ts:65-115`）。
2. **选择不重新派生**：`selectBuild` 直接消费 `ProjectBuild`；studio 缓存 key 只含 `config.tokens`（`src/studio/index.ts:30-46`）。
3. **纯函数、无 I/O**：`buildCore` 不做文件/网络/时间操作，便于在进程内缓存与并行（推理上可并行；当前没有 worker）。
4. **固定步长扫描**：用离散网格换实现简单，避免解析式反解在 sRGB 边界上的复杂分支。

## 瓶颈与反例

- **重复 `chromaMax`**：`toneColor` 每次调用都重新二分色域；`solveFillTone` 201 步会重复求同一 tone 附近的 max。缓存 `(tone, hue, chromaRatio)` 的结果可能显著提速，但会增加状态与失效逻辑；当前 90ms 不值得。
- **`emitTokens` 先构造后过滤**：`src/tools/tokens.ts:35-46` 无论 `platforms` 选什么，都会先 `treeToCss` / `treeToJson` / `treeToDtcg` 三份完整字符串，再 `filter(want)`。只导出 CSS 时仍付 JSON/DTCG 的成本，这是一个**可优化但没有做**的点。推断：改成按 `platforms` 懒构造可省 2/3 发射时间，但收益取决于构建规模。
- **合同不是瓶颈**：133 行看起来多，但颜色报告已在 `deriveColor` 里算好；合同只做转换和几次树遍历。不要为了“优化合同”删检查。
- **不要用 token 数猜性能**：274 个 token 听起来很小，但颜色路径的扫描量是 4 万次色域检查量级；性能由算法步数决定，不由节点数决定。
- **不要给 `selectTree` 加缓存**：单次 0.028ms，缓存命中率不高；加缓存反而引入失效复杂度。

## 构建预算与缓存策略

如果把 `@ultime/core` 放进一个每天构建几十次的项目，建议的预算是：

- **单次全量构建 < 200ms**（当前 90ms 量级，留 2 倍余量）；
- **单次选择导出 < 50ms**（不含 `buildCore`，只过滤 + 发射）；
- **CI 总增量 < 5s**（Node 启动 + 读配置 + 构建 + 写四份产物），超过就值得查是不是缓存/依赖出了问题。

缓存策略按“变化频率”分层：seed 不变时缓存 `ProjectBuild`（studio 已经做了单槽）；selection 变化只重跑 `selectBuild`；只有 `config.tokens` 变化才重新 `buildCore`。不要缓存 `tokens.css` 字符串——它比重新发射还大，且容易和 `--check` 的字节语义打架。

一个容易忽略的成本：`emitTokens` 每次都会先构造三份完整字符串再按平台过滤（`src/tools/tokens.ts:35-46`）。如果配置器每次拖动滑块都触发一次全量导出，用户会感到卡顿；正确做法是预览只跑 `treeToCss`，导出才走 `emitTokens`。

## 读性能数字时不要做的事

- **不要拿单次冷启动当基线**：第一次 `buildCore` 包含模块解析、JIT 和默认 seed 的初始化，通常比稳定态慢一倍以上；做容量规划要看预热后的中位数。
- **不要用 token 数估算**：颜色成本由族数决定，不是由叶子数决定；一个 500 token 但只有 4 个色族的系统，可能比 274 token 但有 12 个色族的系统更快。
- **不要把 `selectBuild` 的耗时算进构建**：它不重新派生，只做过滤与发射；把两者混在一起会高估“切换配置”的成本。
- **不要在没有 profiler 的情况下猜优化点**：当前最值得验证的是 `chromaMax` 的重复调用，而不是合同遍历；先采样再改代码。

## 0.5.1 → 0.7 的性能变化

`kernel.json` 的计数从 0.5.1 到 0.7.0 完全一致（274 token / 133 合同 / 106 颜色 pass），树与合同未变；颜色主路径没有重写。推断：`buildCore` 的 90ms 量级在 0.5.1 也应成立，未实测旧版本。0.7 新增的 `selectBuild` 是“构建后过滤”，不会让全量构建变慢；但每次切换 selection 仍需重新发射产物。

**一句话记住**：这个项目的性能瓶颈不是 token 数量，而是颜色反解里的固定步长扫描；90ms 对 274 个 token 可以接受，真要提速先缓存 `chromaMax` 和按平台懒发射，而不是删合同或删检查。
