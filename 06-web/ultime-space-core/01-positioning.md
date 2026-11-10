# 01 · 定位：一个把设计意图编译成 token 的内核

**这篇回答什么问题**：`@ultime/core` 是什么、谁需要它、它与现有设计 token 工具差在哪、这个项目现在值不值得学。

## 一句话是什么

`@ultime/core` 是一个平台无关的设计系统 token 内核：输入一小份 **seed**（色相、中性配方、画布对称、面目标、圆角基座、字号基准、光源、动效步长），输出一棵 DTCG 形态的 token 树，再翻译成 CSS 变量、原生 JSON、DTCG 交换格式和 `kernel.json`。它不提供组件、类名、布局或配置界面；`README.md:11-20` 明确划了“是什么 / 不是什么”。

它的关键差别不是“又一份 design tokens”，而是 **值由约束算出来**：颜色从 WCAG 对比度目标反解，光影从一盏方向光推出，圆角/字号/动效从基数和档位公式展开。`DESIGN.md:32-73` 把这套原则写成“派生优先于名单”和“数值必须有出处”。

## 谁在什么场景下用它

- 需要一个品牌主题同时产出 Web CSS、原生 JSON 和 DTCG 的快照，且希望每次改 seed 后产物可 diff、可复现的团队。
- 设计系统工程师要把“为什么是 4.5:1 / 为什么是 16px”固化成构建规则，而不是评审口头约定。
- 工具作者要借鉴“输入极简、输出多平台”的 token 编译器，而不是再维护一份手工色板。
- 不适合：只想拿一套成品 CSS 变量的页面作者；需要 Figma 内实时协作编辑的设计团队；把 token 当运行时主题、要求热切换的后台系统。

没有它之前，常见做法是维护 `colors.json` / `tokens.css` 手写清单：改品牌色要人肉重算 hover、pressed、disabled、soft、border、text 六套值，改圆角要在九个文件里同步；或者用 Style Dictionary 做“已有 token 文件的格式转换”，但“值怎么来”仍然靠人。

## 竞品对比

| 方案 | 定位 | 核心差异 | License | 成熟度 |
| --- | --- | --- | --- | --- |
| **ultime-space/core** | seed → token 的生成内核 | 输入是意图而不是 token 清单；颜色/光影是约束求解；构建期合同审计；零第三方运行时依赖（模型层） | MIT | 0 star / 1 fork / 1 contributor；v0.7.0，2026-11-09 |
| **Style Dictionary** | token 转换/构建层 | 读已有 token 文件，按平台 transform + format；不负责“颜色怎么算出来” | Apache-2.0 | 4,880 stars / 647 forks，生态成熟（2026-11-03 仍在更新） |
| **Tokens Studio** | Figma 内 token 编辑与同步 | 面向设计师的可视化编辑、版本与同步；生成逻辑与合同不在插件内 | MIT | 1,630 stars / 229 forks，活跃（2026-11-09） |
| **Open Props** | 成品 CSS custom properties 库 | 直接消费一套预置变量；可改但改的是值，不是派生规则 | MIT | 5,570 stars / 220 forks，活跃（2026-10-11） |
| **手写 CSS 变量 / Tailwind theme** | 项目内手工维护 | 零学习成本；但同一事实有多份名单，改一个参数要全仓同步 | 项目自定 | 取决于团队 |

结论不是“替代 Style Dictionary”：更准确的组合是 **ultime core 负责生成 token，Style Dictionary 负责把 token 分发到更多平台**。ultime 的 DTCG 出口就是为这种接力准备的（`src/exporters/dtcg.ts:82-95`）。

## 为什么是现在

1. **DTCG 2025.10 落地**：设计 token 有了稳定的交换格式，生成器可以只对标准负责，不必为每家工具写私有 JSON（`src/exporters/dtcg.ts:44-80`）。
2. **OKLCH 进入浏览器与设计工具**：感知明度轴可用，颜色求解不必再靠 HSL 的假 L 猜（`src/model/color/oklch.ts:64-93`）。
3. **多端同源成本变高**：Web / 原生 / 小程序 / AI 生成代码都需要同一份 token 事实，手写清单的同步成本超过一次性建生成器。
4. **AI 协作需要确定性**：机器入口是 `kernel.json` 与 `ultime schema --json`，比让 agent 从 Markdown 抄数值可靠（`README.md:314-317`）。

## 项目健康度

- **仓库**：`ultime-space/core`，MIT，TypeScript；2026-11-03 创建，2026-11-09 最近提交（`15fd53ea`，v0.7.0）。
- **社区**：0 star、1 fork、`git shortlog` 只有 1 位作者（UltimeLam）、10 个提交；open issues 0（GitHub API，2026-11-10）。这是一个 **早期个人项目**，不是有社区背书的基建。
- **发布节奏**：6 天发了 v0.4.1 → v0.4.2 → v0.5.0 → v0.5.1 → v0.6.0 → v0.7.0 六个 tag；0.x 阶段 API 仍会变（`CHANGELOG.md:1-33`）。
- **入口**：源码 <https://github.com/ultime-space/core>；npm 包名 `@ultime/core`；没有独立官网或在线 demo。
- **注意**：本分析按任务指定基线 `15fd53ea`。分析窗口内上游又推进了 `0.8.0`（`823ea7d`，2026-11-10T12:57Z），不在本次证据范围，见 08 的局限。

## 它不是什么

- **不是运行时主题库**：产物是构建期生成的文件，不是 `ThemeProvider` / CSS-in-JS 运行时；切换主题靠重新构建或加载另一份 CSS，不靠 JS 状态。
- **不是 Figma 插件**：没有设计工具内编辑、协作、同步能力；它假设“设计决策”已经被写成 seed。
- **不是组件库**：不提供 Button / Card / 布局 / 断点；`README.md:270-278` 明确把角色、语义表、布局、目标尺寸划给上层。
- **不是 token 管理平台**：没有数据库、版本历史、权限、审计日志；这些要么在 git，要么在别的产品里。
- **不是“配色 AI”**：颜色是确定性求解，不是模型生成；同一个 seed 每次得到同一组值。

## 采用前要算的三笔账

1. **迁移账**：如果团队已有一份手写 token 清单，需要先把它反推成 seed（色相、中性配方、面目标、圆角基座、字号阶梯），而不是把清单直接喂进去。仓库没有 Figma/JSON 导入器（`README.md:202-217` 的 CLI 只有 init/build/inspect/schema），这段映射要自己写。
2. **维护账**：项目只有 1 位维护者、10 个提交、0 star（GitHub API，2026-11-10），0.x 阶段 minor 可破坏；用它的团队要准备好自己读源码、提 PR、锁版本。
3. **锁定账**：核心锁定风险不高——树是 DTCG 形态，`tokens.dtcg.json` 可以接力给 Style Dictionary 或其他平台工具（`src/exporters/dtcg.ts:82-96`）；真正锁定的是 seed 的字段语义和颜色目标，换实现时要重新校准。

## 一句话结论

**值得学它的“从意图派生 + 构建期合同 + 多出口同源”的架构，不值得在没有维护预算的团队里直接生产使用**；最适合把它当设计系统内核的参考实现，或作为内部 token 编译器的起点。它的真正价值在于把“设计取舍”变成可复现、可审计、可回滚的工程对象，而不是提供一套好看的默认色板。

**一句话记住**：它卖的不是 274 个 token，而是“改一个 seed，274 个值一起讲得通”的生成规则。
