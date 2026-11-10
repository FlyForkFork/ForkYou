# ultime-space-core

> 把一组 seed 参数算成 274 个 token：seed → 一棵树 → 四份快照，CSS 只是其中一个出口。

`@ultime/core` 是平台无关的设计系统内核。它不提供组件或配置界面，只把色相、中性配方、画布对称、面目标、模式、圆角、字号、光源、动效等 seed 输入派生为 DTCG 形态的 token 树，再翻译成 CSS / JSON / DTCG / `kernel.json`。当前分析基线 `15fd53e`（v0.7.0，MIT，75 个文件，仅 `main`）。

**为什么值得看**

- **派生优先**：圆角、字号、阴影、动效、面阶、线墨、状态墨都由公式或对比度目标反解，不存第二份名单。
- **可静态审计**：274 个 token、133 条合同、34 类合同 ID；结构合同失败即构建失败，颜色项只报告。
- **可复现**：同 seed 同版本逐字节相同；manifest 不含时间戳与绝对路径，`seedHash` 用 FNV-1a。
- **方向有守卫**：`model/**` 不得反向依赖，四个类别互不 import，模型值不得出现载体语法。

**文档导航**

| 文件 | 内容 |
| --- | --- |
| [01-positioning.md](01-positioning.md) | 定位、竞品与项目健康度 |
| [02-architecture.md](02-architecture.md) | 五层架构、数据流与关键决策 |
| [03-code-tour.md](03-code-tour.md) | 从 `buildCore` 出发的代码走读 |
| [04-deep-dive-build-guards.md](04-deep-dive-build-guards.md) | 合同、守卫与单一构建计划 |
| [04-deep-dive-color-derivation.md](04-deep-dive-color-derivation.md) | OKLCH + WCAG 的颜色求解 |
| [04-deep-dive-selection-pipeline.md](04-deep-dive-selection-pipeline.md) | 0.7 选择模型与参数化派生 |
| [05-performance.md](05-performance.md) | 构建成本、复杂度与本机实测 |
| [07-contribute.md](07-contribute.md) | 工具链、CI 与贡献入口 |
| [08-takeaways.md](08-takeaways.md) | 可迁移想法、面试卡与局限 |
| [09-ops.md](09-ops.md) | 安装、配置、升级与排障 |

[Guide（图册）](https://flyforkfork.github.io/ForkYou/06-web/ultime-space-core/guide.html)
