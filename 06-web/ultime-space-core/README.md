# ultime-space-core

> 把一组 seed 参数算成 274 个 token：seed → 一棵树 → 四份快照，Web 的 CSS 只是其中一个出口。

`@ultime/core` 是平台无关的设计系统内核。它不提供组件、类名或配置界面，只做一件事：把色相、中性配方、画布对称、面目标、前景、模式、圆角、字号、字体、光源、动效这些 seed 输入，派生成 DTCG 形态的 token 树，再翻译成 CSS / JSON / DTCG / `kernel.json`。零第三方运行时依赖，Node >= 22.18。

**为什么值得看**
- **派生优先**：圆角、字号、阴影、动效、面阶、线墨、状态墨全部由公式或对比度反解得出，不存第二份名单。
- **可静态审计**：274 个 token、133 条合同、34 类合同 ID；结构合同失败即构建失败，颜色报告写进 manifest。
- **可复现**：同一 seed 同一版本逐字节相同，manifest 不含时间戳与绝对路径，`seedHash` 用 FNV-1a。
- **方向有守卫**：`model/**` 不得反向依赖，四个类别互不 import，模型值不得出现 `px`/`rem`/`var()`/`color-mix`。

**快速入口**
- `src/build.ts:57-94` — 唯一装配点 `buildCore`。
- `src/seed.ts:136-198` — 默认 seed，所有可调参数的唯一真源。
- `src/model/color/derive.ts:474-966` — 颜色派生主链路。
- `scripts/check-model.ts:38-82` — 零依赖 / 方向 / 类别隔离守卫。

**文档**
[定位](01-positioning.md) · [架构](02-architecture.md) · [代码走读](03-code-tour.md) · [颜色派生](04-deep-dive-color-derivation.md) · [构建守卫](04-deep-dive-build-guards.md) · [性能](05-performance.md) · [分支](06-branches.md) · [贡献](07-contribute.md) · [takeaways](08-takeaways.md) · [运维](09-ops.md)

分析基线：`a0dd5ddfe2eab3298e76b90d6ef9aae216f8b26a`（v0.5.1，2026-11-07，MIT，71 文件，仅 `main` 分支）。
