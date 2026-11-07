# 05 · 性能：一个构建期内核的时间都花在哪

> 结论先行：`@ultime/core` 不是运行时性能型项目，它没有服务、没有查询、没有缓存命中率。性能问题只有一个场景：**构建一次 token 要多久、产物多大、增量是否可预测**。从代码结构与实测产物看，这是一套常量级、毫秒到百毫秒量级的离线构建，真正的成本在维护 133 条合同与四份产物，而不在计算。

## 先给数据

以下数字来自仓库内已提交的产物与源码，不是跑分：

| 指标 | 数值 | 来源 |
|---|---|---|
| token 总数 | 274 | `kernel.json` 的 `counts.total` |
| 颜色 token | 194（占 70.8%） | `kernel.json` 的 `counts.byCategory.color` |
| 合同总数 | 133 条，34 类 ID，0 失败 | `kernel.json` 的 `contracts` |
| 颜色报告 | 106 条 level 记录 | `kernel.json` 的 `color.levels` |
| CSS 产物 | 59,587 字节 | `tokens.css` |
| JSON 产物 | 30,203 字节 | `tokens.json` |
| DTCG 产物 | 179,458 字节 | `tokens.dtcg.json` |
| manifest | 41,054 字节 | `kernel.json` |
| 源码规模 | src+scripts+tests 约 5,317 行，71 个 git 文件 | 本地 clone 统计 |

四份产物合计约 310 KB。DTCG 最大，因为它把每个模式值拆成两个 token 并带 `$extensions`（`src/exporters/dtcg.ts:82-95`）；CSS 最小，因为变量名复用且模式值压缩成两个值位（`src/exporters/css.ts:180-186`）。

## 构建复杂度

`buildCore` 的每一步都可以按输入规模写出上界：

- **骨架**：18 档 space + 5 档 size + 9 档 radius + 9 档字号 + 4 档行高 + 5 档字距 + 2 套字体 + 3 档字重，全部是常量循环，O(档位数)（`src/model/skeleton.ts:58-103`）。
- **颜色**：设语义色族数为 F（默认 4 个：danger/warning/success/info），每个族每种模式做一次 `solveFillTone`（通常 light/dark 各一次），最多 201 个采样点（`src/model/color/derive.ts:91-122`）；每个面/线/状态做一次 `solveCoverage`，步长 0.002、最多约 500 次（`src/model/color/math.ts:194-202`）；OKLCH 色域边界每个颜色一次 20 次二分（`src/model/color/oklch.ts:73-86`）。总量是 F × 常数，与 token 总数线性相关但常数很小。
- **光影**：4 档阴影 × 最多 3 层 + 4 档遮挡 + 每档 4 条受光边，O(1)（`src/model/light.ts:126-179`）。
- **动效**：6 档 duration + 3 档 loop + 3 档 delay + 4 种缓动，O(1)（`src/model/motion.ts:47-94`）。
- **合同**：133 条固定检查，每条只读几个节点，O(1)。
- **出口**：遍历一次树，O(token 数)，每个 token 做字符串拼接。

所以整体是 **O(F × 求解步数 + token 数)** 的常量级构建；没有嵌套遍历整棵树去查另一个节点，也没有递归深度与 token 数相关的算法。

## 实测与推断的边界

项目没有 benchmark、没有性能测试、没有 CI 计时门槛。因此「构建耗时多少毫秒」必须标**待查实**：本地可以跑 `time pnpm build:tokens`，但结果强依赖机器与 Node 版本，不能当作项目指标。

可以确定的是**不需要运行时性能优化**：这个包在消费端只暴露纯函数与字符串产物，不参与页面渲染；CSS 变量由浏览器原生解析，JS 侧没有热点循环。真正该关注的是：

1. **构建缓存**：同一 seed 重复构建会重复算全部颜色；如果上层每次保存都触发构建，可以在调用方按 `seedHash` 做缓存（内核本身不提供）。
2. **产物体积**：DTCG 179 KB 对设计 token 来说偏大，主要因为模式值拆 token 与 `$extensions`；如果只服务 Web，CSS 59 KB 更实际。
3. **合同维护成本**：133 条合同是人力成本，不是 CPU 成本；新增一个 token 类别要补合同与测试，这部分会随功能增长。

## 为什么不做缓存

`buildCore` 是纯函数，理论上可以用 `seedHash` 做 memoize。项目没有做，原因（推断：从设计原则与测试约束判断）有三：

- 内核要保证「同一输入同一输出」，缓存会引入生命周期与失效策略，反而增加不确定性。
- 构建发生在 CLI/CI，不在请求路径；一次几百毫秒的重复计算不值得为它引入状态。
- 零依赖约束下，没有成熟的缓存库可用，手写 Map 又要处理内存上限。

如果未来要在 Studio 里做实时预览，缓存应该加在 `themeStudio` 的调用层，而不是 `buildCore` 内部。

## 产物体积的取舍

`tokens.css` 59 KB 未压缩，gzip 后预计 8–12 KB（推断：CSS 变量文本压缩率高，但未实测）。对现代 Web 来说可接受；如果只用一个主题，可以在出口层做 subset（`src/tools/tokens-config.ts:33-67` 的九维子集），把 space/motion 等裁掉。注意 subset 只裁「原语档位」，颜色语义节点仍会生成，因为它们是合同的输入。

## 结论

**性能不是这个项目的卖点，也不是它的风险。** 它是一次离线编译：274 个 token、133 条合同、四份约 310 KB 的产物，复杂度常量级，没有运行时热点。真正需要盯的是构建耗时（待实测）与合同维护成本；前者可以用调用方缓存解决，后者只能靠「加 token 必须加合同」的纪律控制。
