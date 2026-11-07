# 04 · 深挖：确定性构建与守卫体系

> 结论先行：`@ultime/core` 把「构建」当成一份可审计的合同，而不是一次脚本执行。同一 seed、同一版本必须逐字节产出一模一样的四份文件；谁引了不该引的包、谁把模型层写脏、谁手改了生成物，CI 和 pre-commit 都会拦住。核心手段是**纯函数装配 + 稳定序列化 + 合同断言 + 静态守卫**。

## 问题：一个 token 构建器会怎么烂掉

设计系统仓库最常见的腐烂路径有三条：

1. **生成物被手改**：线上缺一个颜色，工程师直接编辑 `tokens.css`；下次构建被覆盖，事故复现不了。
2. **依赖方向倒灌**：模型层为了省事 import 了 exporter，或者颜色代码 import 了 CLI；编译能过，但包一旦被浏览器/边缘运行时引用就炸。
3. **构建不可复现**：manifest 里写入时间戳、绝对路径或随机数，两个环境构建出不同 hash，缓存、审计、回滚都失效。

本项目的守卫分别对准这三条：产物同源校验、模型方向守卫、类别隔离守卫、manifest 无时间戳。

## 朴素做法为什么不够

- **只靠 code review**：人能看见明显的反向 import，但看不见 `../exporters/css` 这种相对路径，也记不住四个类别之间「谁都不能 import 谁」。
- **只靠 TypeScript**：类型系统不约束模块图；`import { treeToCss } from '../exporters/css'` 在 model 里完全合法。
- **只靠 ESLint**：可以配 `no-restricted-imports`，但项目要求零第三方运行时依赖，也不想为一条守卫引入整个 lint 生态；作者选择 90 行手写脚本（`scripts/check-model.ts`）。
- **只靠快照测试**：快照能发现变化，但不能证明「变化是合法的」；`rules/03-testing.md` 明确说快照不能替代合同。

## 核心机制

### 1. seed 解析：唯一输入，稳定哈希

`resolveSeed` 把用户传入的 partial seed 与 `DEFAULT_SEED` 深合并：对象递归合并、数组整体替换、`null` 表示显式清空（`src/seed.ts:200-212`）。合并结果再经 `stableStringify` 按键排序序列化（`src/seed.ts:228-235`），最后用 FNV-1a 32 位得到 `seedHash`（`src/seed.ts:237-246`）。FNV 不是密码学哈希，只用于「同 seed 同版本」的快速指纹；manifest 里因此没有时间戳、没有机器名、没有绝对路径（`src/build.ts:97-129`）。

### 2. 装配：四个纯函数，一个出口

`buildCore` 的顺序是固定的：`resolveSeed → deriveSkeleton → prepareLight → deriveMotion → 拼树 → auditContracts → countByCategory`（`src/build.ts:57-94`）。每个模型只接收 seed 与上游结果，不读文件、不读环境变量、不写全局缓存；`prepareLight` 甚至把颜色算出的 `shadowInk` 作为输入传给光影模型（`src/build.ts:42-49`），保证「同一枚墨」不是靠约定而是靠数据流。

树的拼接也是显式的：骨架全部展开，颜色只取 surface/ink/line/tone/state/scrim 六个子组，再挂 shadow/occlusion/highlight/shade/motion（`src/build.ts:70-90`）。没有隐式注册表，也没有「插件自动发现」。

### 3. 合同：133 条断言，分两级

`auditContracts` 生成 133 条合同记录，归为 34 类 ID（`kernel.json`）。合同分两级：

- **结构合同（blocking）**：space 18 档严格递增且为正（`src/contracts.ts:163-173`）、size 5 档每档 +8（`src/contracts.ts:174-183`）、radius 必须等于 `(n−1)×base`（`src/contracts.ts:184-189`）、字号必须是 `base+steps` 且递增（`src/contracts.ts:190-201`）、动效必须由 unit×n 派生（`src/contracts.ts:221-231`）、阴影必须 4 档且层数正确（`src/contracts.ts:280-290`）、树里不得出现 role/roles/mass/profile 语义节点（`src/contracts.ts:302-311`）、不得出现 `var(`/`color-mix`/`--` 载体语法（`src/contracts.ts:314-323`）。
- **颜色报告（非 blocking）**：面/线/墨/色族的对比度记录为 pass/warn，`failed` 只统计 `blocking && !pass` 的行（`src/contracts.ts:374-375`）。所以颜色偏差不会让构建失败，但会写进 manifest 的 `color.report`，可被上层策略读取。

### 4. manifest：把构建结果变成可审计对象

`buildManifest` 输出 schemaVersion 6.0.0、engineVersion 0.5.0、单位、主题模式、完整 seed、`seedHash`、动效缓动、counts、contracts 的 total/failed/ids、color 的 levels/report 以及 artifacts 清单（`src/build.ts:97-129`）。它不包含「构建时间」——这不是疏忽，而是可复现性的必要条件。`tests/core.test.ts:225-230` 专门断言 manifest 里没有时间戳字段。

### 5. 方向守卫：静态扫描 import

`scripts/check-model.ts` 把守卫拆成五个检查：

- **core-dependency**：除 `node:` 外，非相对 import 一律拒绝；唯一例外是 `src/studio/**` 可以用 `@ultime/studio`，`src/cli/**` 可以用 `@ultime/cli`（`scripts/check-model.ts:43-51`）。这保证 core 的运行时依赖只有两个同作者包，模型层永远零第三方依赖。
- **core-scope**：禁止 `../..` 越出 core 根目录（`scripts/check-model.ts:54-58`）。
- **model-direction**：`src/model/**` 不得 import `build`、`exporters`、`tools`、`studio`、`contracts` 或 `index`（`scripts/check-model.ts:61-65`）。
- **category-isolation**：`model/<category>/` 子目录之间不得互相 import；需要注意 `skeleton.ts`、`light.ts`、`motion.ts` 是单文件，`categoryOf` 的正则只识别子目录（`scripts/check-model.ts:33-36`），因此这三者与 color 的隔离当前主要靠约定，守卫覆盖有限（推断）。需要共享的类型可新建 `src/model/types.ts` 或上移到 `src/tree.ts`（`scripts/check-model.ts:66-69`）。
- **model-forbidden-token**：构建默认 seed 后，把整棵树序列化，用正则检查 `var(`、`color-mix`、`--[a-z]` 是否出现（`scripts/check-model.ts:74-82`）。模型只能产出值、量纲与 `$type`，载体语法属于出口。

### 6. 产物同源：逐字节比对

`scripts/build.ts --check` 不写盘，只把内存中生成的四份产物与磁盘上的文件逐字节比较；不一致时打印 drift 并以退出码 1 结束（`scripts/build.ts:44-55`、`85-92`）。pre-commit 钩子先跑 `vp staged`，再跑 `build.ts --check`，最后跑 `check-model.ts`（`.githooks/pre-commit:23-30`）；CI 则把 `pnpm check` 作为主闸（`.github/workflows/ci.yml:30-34`）。任何人改了 seed 或模型却没重新生成，提交阶段就会失败。

## 代码证据

1. **稳定合并与哈希**：`src/seed.ts:200-246`，数组替换、null 清空、键排序、FNV-1a 一条链。
2. **唯一装配点**：`src/build.ts:57-94`，四模型顺序固定，树拼接显式。
3. **结构合同失败即失败**：`src/contracts.ts:374-375` 只把 blocking 的失败计入 `failed`，`scripts/build.ts:94` 据此退出 1。
4. **无时间戳 manifest**：`src/build.ts:97-129` 与 `tests/core.test.ts:225-230` 的断言互相印证。
5. **五组检查**：`scripts/check-model.ts:33-82`，categoryOf + import 扫描 + 默认树正则。
6. **产物同源**：`scripts/build.ts:44-55` 的逐字节比对与 `.githooks/pre-commit:23-30` 的提交前重算。

## 复杂度与边界

- **构建复杂度**：骨架 O(档位数)，颜色 O(色族数 × 求解步数)，光影 O(层数)，动效 O(轴数)；整体是常量级，不随 token 总数超线性增长。实际构建时间待实测（项目未提供 benchmark）。
- **守卫边界**：`check-model.ts` 是静态文本扫描，不是 TypeScript AST；它按正则匹配 `import`/`from` 说明符，能覆盖常见的静态与 `import()` 形式，但对 `require()`、路径别名、条件导出等覆盖有限（推断：基于源码实现判断）。它也不是安全边界，只是方向约定。
- **合同边界**：结构合同能保证「派生一致」，不能保证「设计好看」；颜色报告不阻断，需要上层自己决定是否把 warn 升级为失败。
- **确定性边界**：FNV-1a 32 位存在碰撞可能；它用于指纹而非安全校验。项目没有把它当作内容寻址存储的 key。

## 取舍

**用 90 行手写守卫替代 ESLint 规则**。代价是覆盖不如成熟 lint 全面，收益是零依赖、启动快、规则与仓库结构强绑定。对于只有 71 个文件的内核，这是合理的懒办法；如果仓库长到几百个文件，应该换成基于 TypeScript Program 的检查。

**结构合同严格、颜色合同宽松**。这是把「可计算」与「需审美」分开：字号/圆角/动效是纯数学，失败一定是 bug；颜色对比度受色域与品牌限制，失败可能是合理取舍。这个分级比「全部阻断」或「全部警告」都更实用。

## 可迁移的三件事

1. **把生成物同源校验放进提交钩子**：比「请勿手改」的注释有效一百倍；`--check` 模式是低成本高收益的标配。
2. **manifest 去掉时间戳**：可复现构建的第一步；需要审计时间就放到外部发布记录，不要污染产物。
3. **用目录边界做架构约束**：`model` 不得 import `exporters` 这类规则，写成 90 行脚本就能在 CI 里强制执行，不必等 code review。
