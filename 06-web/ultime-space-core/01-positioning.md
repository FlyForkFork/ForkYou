# 01 · 定位：一颗 seed 能不能长出一套设计系统

> 这篇回答：`@ultime/core` 在 2026 年的设计 token 工具链里占哪个位置？它和 Style Dictionary、Tokens Studio、Open Props 的本质差别是什么？现在学它是不是好时机？

## 一句话是什么

**把设计决策压缩成一组 seed，再按确定性规则长成 token 树的「设计系统内核」**。输入是色相、中性配方、画布、面目标、前景、模式、圆角、字号、字体、光源、动效；输出是平台无关的 DTCG 树，再翻译成 CSS、JSON、DTCG 与 `kernel.json` 四份快照。它不提供组件，也不提供 Figma 界面，更像一台「token 编译器」。

核心证据在唯一装配点：`buildCore` 把 seed 依次交给骨架、颜色、光影、动效四个纯函数模型，拼成一棵树后跑合同审计（`src/build.ts:57-94`）。seed 的类型定义覆盖了上述全部输入（`src/seed.ts:26-127`），默认值集中在 `DEFAULT_SEED`（`src/seed.ts:136-198`），没有第二份配置名单。

## 谁在什么场景下用它

- **设计系统工程师**：手上有一组品牌色和一套比例规则，不想维护几百行手写 token。改 `primaryHue` 或 `faceContrast`，整棵颜色树跟着重算，连同 hover/pressed/disabled 与对比度报告一起更新（`src/model/color/derive.ts:474-966`）。
- **多品牌 / 多主题产品**：同一套骨架派生 light/dark 两套值，模式值在树里是作用域而不是两份拷贝（`src/tree.ts:61-64`）。
- **需要把设计约束送进 CI 的团队**：133 条合同、34 类合同 ID，结构合同失败直接让构建退出 1（`src/contracts.ts:159-376`、`scripts/build.ts:94`）。
- **想接 DTCG 下游的团队**：`tokens.dtcg.json` 直接带 `$type`/`$value` 与 `$extensions`，能被 Style Dictionary 等消费者继续加工（`src/exporters/dtcg.ts:82-95`）。

## 没有它之前，人们怎么做

主流做法是「先有 token 清单，再做转换」：设计师在 Figma 里维护变量，或者工程师手写 JSON/YAML，然后交给 Style Dictionary 之类工具输出 CSS/SCSS/iOS/Android。问题不在转换，而在**清单本身没有生成逻辑**：品牌色换了，浅色 soft、边框、文字、8 个状态的填充要人工重配；对比度是否达标靠目测或散落的脚本；同一个事实在 Figma、JSON、CSS 里各存一份，漂移是常态。

`@ultime/core` 把重心前移到「派生」：只保留 seed 这一份事实，面阶、线墨、状态墨、阴影、字号、圆角都由公式或对比度反解得出（`DESIGN.md:32-44`）。这也是它和纯转换工具最根本的分界。

## 竞品对比

| 方案 | 定位 | 核心差异 | License | 成熟度（2026-11-07） |
|---|---|---|---|---|
| **ultime-space/core** | seed 驱动的设计系统内核 | 自带颜色/光影/动效派生模型；token 树 + 合同 + manifest 一体；零运行时依赖 | MIT | 0 stars、1 fork；2026-11-03 创建，最新 v0.5.1；单人/早期项目 |
| **Style Dictionary** | 跨平台 token 构建系统 | 强在 transform/format 与多平台出口；输入仍需你提供 token 源，不负责「从 seed 推导」 | Apache-2.0 | 4,879 stars、647 forks；2016 年创建；生态成熟 |
| **Tokens Studio** | Figma 内的 token 管理与同步插件 | 设计侧编辑体验最好，主打 Figma 与 Git 同步；派生能力依赖手写数学或第三方插件 | MIT | 1,629 stars、229 forks；2020 年创建；设计团队常用 |
| **Open Props** | 一套现成的 CSS 自定义属性 | 直接给你 500+ 个变量，开箱即用；没有 seed、没有派生、没有对比度合同 | MIT | 5,569 stars、220 forks；2021 年创建；偏 CSS 工具库 |

三者的分层很清楚：Style Dictionary 是**转换层**，Tokens Studio 是**编辑层**，Open Props 是**成品层**，`@ultime/core` 想做的是**生成层**——把「设计意图」编译成 token。它不是要替代 Style Dictionary，而是可以接在它前面：`tokens.dtcg.json` 是标准 DTCG，天然能继续走 Style Dictionary 的 format 流程（`src/exporters/dtcg.ts:82-95`）。

## 差异化在哪

1. **输入是意图，不是清单**：`DEFAULT_SEED` 里没有 `color.surface.card` 这种最终值，只有 `faceContrast.card=1.1` 这样的目标（`src/seed.ts:52-66`），最终 hex 由 `solveCoverage` 反解（`src/model/color/math.ts:194-202`）。
2. **合同是构建的一部分**：结构合同失败即构建失败，颜色对比度只报告不阻断（`rules/02-tokens.md:35-37`）。这让「设计约束」变成可执行断言，而不是评审意见。
3. **产物同源**：`build.ts --check` 逐字节比对四份产物，pre-commit 再跑一遍（`scripts/build.ts:44-55`、`.githooks/pre-commit:23-30`）。改 seed 不重新生成，提交会失败。
4. **零运行时依赖**：`dependencies` 只有同作者的 `@ultime/cli` 与 `@ultime/studio`，模型层不引任何第三方库（`package.json:91-94`、`scripts/check-model.ts:38-72`）。

## 项目健康度

- **热度**：0 stars、1 fork、0 open issues（GitHub API，2026-11-07）。非常早期，不能当作「社区已验证」的生产依赖。
- **版本**：0.5.1，创建于 2026-11-03；浅克隆可见 tag 从 v0.4.1 到 v0.5.1，最新 commit 为 `a0dd5dd chore(release): 0.5.1`（work.json）。
- **代码量**：71 个文件，src+scripts+tests 约 5,317 行；5 个测试文件、2 条 GitHub Actions 工作流。
- **License**：MIT，可商用；但包版本仍是 0.x，API 可能破坏性变化（`rules/04-release.md:9-15` 把包版本、schemaVersion、engineVersion 分开管理，说明作者自己也在防升级风险）。
- **维护者**：本地浅克隆只展开 4 个 tag 提交，贡献者数量待查实。

## 结论

**值得学，不值得现在无脑上生产。** 它最值钱的是「seed → 派生 → 合同 → 快照」这条流水线的抽象方式，以及颜色反解、零依赖守卫、产物同源这些可迁移工程手法；但项目太年轻、可见历史很浅、生态为零，适合作为设计系统内核的参考实现，或者小团队自用的起点。适合读者：想理解 token 系统怎么从「手写清单」进化到「可计算模型」的工程师。

**外部来源**
1. ultime-space/core 仓库与 GitHub API：https://github.com/ultime-space/core（2026-11-07）
2. Style Dictionary 官方仓库：https://github.com/style-dictionary/style-dictionary（2026-11-07）
3. Tokens Studio for Figma 官方仓库：https://github.com/tokens-studio/figma-plugin（2026-11-07）
4. Open Props 官方仓库：https://github.com/argyleink/open-props（2026-11-07）
5. W3C Design Tokens Community Group, DTCG Format Module 2025.10：https://www.designtokens.org/tr/2025.10/format/（2025-10-28 发布，2026-11-07 查阅）

> 一句话记住：**别人给你 token，它给你「生产 token 的机器」；机器还很小，但图纸值得抄。**
