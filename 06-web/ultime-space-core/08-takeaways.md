# 08 · 心得：从 274 个 token 里能带走什么

> 结论先行：这个项目最值得学的不是「怎么生成 CSS 变量」，而是**把设计意图变成可计算、可验收、可复现的对象**。下面 8 条可迁移想法，每条都对应仓库里的具体机制；后附 8 张面试卡与 4 句吹 B 文案。

## 可迁移的 8 个想法

### 1. 存目标，不存结果

**问题**：设计 token 一改就漂移，因为每个最终值都是手写的。
**做法**：seed 只存 `faceContrast.card=1.1` 这种目标，最终 hex 由 `solveCoverage` 反解（`src/model/color/derive.ts:584-607`）。
**为什么好**：换品牌色时不用重配 194 个颜色，只改一个色相；目标本身还能被合同验收。
**怎么用**：任何「配置系统」都可以先问：这个值是意图还是结果？意图进配置，结果由代码算。

### 2. 在正确的空间做正确的事

**问题**：HSL 调明度看起来对，对比度经常不达标。
**做法**：OKLCH 管色相/chroma，WCAG 相对亮度管明度，sRGB 管色域（`src/model/color/oklch.ts:73-86`、`src/model/color/math.ts:104-112`）。
**为什么好**：每个空间只解决自己擅长的问题，避免「一个公式包打天下」。
**怎么用**：颜色计算先问三件事——色相感知、对比度、色域，分别找对应空间。

### 3. 用合同代替评审意见

**问题**：设计规范写在文档里，没人执行。
**做法**：133 条合同，结构失败即构建失败，颜色偏差只报告（`src/contracts.ts:159-376`）。
**为什么好**：可执行的规格比「请注意间距」有效；分级让审美问题不被机械阻断。
**怎么用**：把团队最常吵的 5 条规则写成断言，先跑起来，再慢慢加。

### 4. 生成物同源校验进提交钩子

**问题**：生成的 CSS 被手改，下次构建覆盖，事故无法复现。
**做法**：`build.ts --check` 逐字节比对，pre-commit 重算（`scripts/build.ts:44-55`、`.githooks/pre-commit:23-30`）。
**为什么好**：把「不要手改」从注释变成失败；成本只有一次构建。
**怎么用**：任何 codegen 项目都该有 `--check` 模式，并挂在 CI 或 pre-commit。

### 5. manifest 去掉时间戳

**问题**：同一份源码在两个环境构建出不同 hash，缓存与审计失效。
**做法**：`buildManifest` 只写 seed、seedHash、counts、contracts、artifacts（`src/build.ts:97-129`）。
**为什么好**：可复现构建的前提是产物只依赖输入，不依赖环境。
**怎么用**：构建产物里禁止 `Date.now()`、绝对路径、主机名；审计信息放外部。

### 6. 方向约束写成 90 行脚本

**问题**：模型层反向 import 出口层，类型检查发现不了。
**做法**：`check-model.ts` 扫描 import，定义 core-dependency/model-direction/category-isolation/model-forbidden-token 四类检查（`scripts/check-model.ts:38-82`）。
**为什么好**：零依赖、启动快、规则与目录强绑定；比引入整套 lint 便宜。
**怎么用**：小仓库先写 50 行脚本守三条最重要的依赖规则，长大了再换 AST 工具。

### 7. 一个节点，多种出口形态

**问题**：light/dark 两套值如果存两棵树，同步必漂移。
**做法**：树里用 `ModeValue` 一个节点，CSS 拆两个值位，DTCG 拆两个 token（`src/tree.ts:61-64`、`src/exporters/css.ts:180-186`）。
**为什么好**：模型只关心「这个 token 有两种模式」，出口各自决定怎么表达。
**怎么用**：多主题/多平台系统，把「值」与「载体」分开，IR 保持最小。

### 8. 零依赖是架构约束，不是口号

**问题**：一个工具库引入十几个依赖，最终没人敢升级。
**做法**：`dependencies` 只有同作者的两个包，模型层零第三方（`package.json:91-94`、`scripts/check-model.ts:38-56`）。
**为什么好**：供应链小、启动快、可移植；代价是很多事要自己写。
**怎么用**：核心计算层坚持零依赖，边缘适配层再引入生态；用守卫把这条线钉死。

## 面试问答卡

**Q1：这个项目怎么保证同一 seed 构建结果一致？**
A：`resolveSeed` 深合并后 `stableStringify` 按键排序，FNV-1a 得 `seedHash`；manifest 不含时间戳/路径；`build.ts --check` 逐字节比对四份产物（`src/seed.ts:228-246`、`src/build.ts:97-129`）。

**Q2：颜色对比度是怎么反解的？**
A：`solveCoverage` 以 0.002 步长找最小覆盖度，`solveAlpha` 以 0.005 步长找最小 alpha；两者都用 WCAG 相对亮度算对比度，向上取整留余量（`src/model/color/math.ts:183-202`）。

**Q3：为什么要用 OKLCH，不直接用 HSL？**
A：HSL 的 L 不是感知明度，同一 L 的黄蓝亮度差很大；OKLCH 的 L 更接近感知，chroma 还能用二分找到 sRGB 边界（`src/model/color/oklch.ts:64-94`）。

**Q4：133 条合同会不会太重？**
A：合同是构建的一部分，不是额外测试；34 类 ID 覆盖几何/字号/动效/阴影/结构/颜色。结构合同阻断，颜色只报告，分级控制了维护成本（`src/contracts.ts:374-375`）。

**Q5：零第三方依赖怎么守？**
A：`check-model.ts` 扫描所有 import：除 `node:` 外，非相对 import 一律拒绝，例外只有 studio/cli 各自用同作者包；model 不得 import 上层，四类原则上互不 import（`scripts/check-model.ts:38-82`）。

**Q6：light/dark 两套值怎么存？**
A：树里一个 `ModeValue {light,dark}`，CSS 输出 `-light/-dark` 两个值位加无后缀开关，DTCG 拆两个 token（`src/tree.ts:61-64`、`src/exporters/dtcg.ts:67-80`）。

**Q7：如果新增一个 token，要改哪些地方？**
A：tree 类型（如需）→ 模型派生 → build 拼接 → contracts 合同 → tests 回归 → `pnpm build:tokens` 重算产物；六处缺一不可（`src/build.ts:70-90`、`rules/03-testing.md`）。

**Q8：这个项目最大的架构风险是什么？**
A：根入口加四个子入口都是 API 面，0.x 阶段路径一动就是破坏性变更；另外 133 条合同让新增 token 的维护成本不低（`package.json` 的 exports、`src/contracts.ts:159-376`）。

## 吹 B 一句话

1. **「它把设计系统从一张手写清单，变成了一台可复现的编译器：输入一组 seed，输出 274 个 token 和 133 条可执行合同。」**
2. **「颜色不是选出来的，是解出来的：OKLCH 管色相，WCAG 管明度，sRGB 管边界。」**
3. **「零依赖不是洁癖，是架构：90 行守卫让模型层永远不可能反向依赖出口层。」**
4. **「同一 seed、同一版本，四份产物逐字节相同；manifest 里连一个时间戳都没有。」**

## 一句话总结

**好架构不是让代码更聪明，而是让错误更难发生。** 这个项目用 seed、合同、守卫、同源校验四件套，把「设计系统会漂移」这件事变成了构建失败。
