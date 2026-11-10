# 04 · 深潜：构建守卫——让“架构约束”变成构建失败

**这篇回答什么问题**：一个生成器怎么保证“同一 seed 产出同一份结果”，又怎么保证作者不会在不知不觉中把方向、契约或载体语法写坏。

## 1. 问题是什么

这个仓库要同时守住三类东西：

1. **值的正确性**：274 个 token 必须满足几何递增、圆角公式、字号阶梯、动效公式、颜色对比度等约束；
2. **结构的正确性**：树里不能出现 `role` / `mass` / `profile` 这类语义节点，不能出现 `var()` / `color-mix` / `--x` 这类载体语法；
3. **方向与依赖的正确性**：`model/**` 不能反向 import `build` / `exporters` / `tools` / `studio`，四个模型类别不能互相 import，core 不能引第三方运行时依赖。

问题在于：这些约束如果只写在文档里，第一次赶工期就会被绕过；如果只靠 code review，reviewer 要同时记得 34 类合同 ID 和 5 类依赖规则。仓库的答案是 **把约束变成构建的一部分**：合同在 `buildCore` 里跑，静态守卫在 `pnpm check` 里跑，产物同源在 `build --check` 里跑。

## 2. 朴素做法为什么不够

- **只写测试**：测试可以覆盖“某个 seed 下颜色达标”，但不能保证“换一个 seed 后仍然单调/仍然有 4 档”。合同把“对所有 seed 都成立的形状”写成断言，测试只需要抽样。
- **只写文档/评审清单**：`DESIGN.md` 的八条原则很好，但评审者会累、会漏；`check-model.ts` 用 90 行把 5 条红线变成退出码。
- **只比对快照**：快照能发现“产物变了”，不能解释“为什么变”；合同输出 `actual / target / pass / blocking`，能直接定位是哪条规则破了。
- **在出口里做校验**：CSS / JSON / DTCG 三个出口各写一套校验，必然漂移。这个仓库把校验放在树和合同层，出口只翻译。

## 3. 核心机制

### 3.1 纯函数装配 + 单一构建计划

`buildCore(input: SeedInput = {})` 不读文件、不写文件、不取时间，只做 `resolveSeed → 四个模型 → 拼树 → auditContracts → countByCategory`（`src/build.ts:57-94`）。0.6 起，`planProject` 把这次派生固定成 `ProjectBuild`：

```ts
// src/tools/project.ts:65
const core = buildCore(inputSeed)
const artifacts = emitTokens(core, { platforms, output })
const diagnostics = contractDiagnostics(core)
return { config, core, manifest: buildManifest(core), artifacts, diagnostics }
```

CLI、`inspect`、`scripts/build.ts`、studio 的 validate/preview/export 都消费这一份结果；0.6 的 Breaking 正是删掉 `tokens.subset` / `tokens.config.json`，避免“同一个 seed 在 CLI 和 studio 里各派生一次”（`CHANGELOG.md:14-22`）。

### 3.2 合同：133 行，34 类 ID，分阻断级

`auditContracts` 生成 `ContractReport { rows, total, failed, ids }`（`src/contracts.ts:42-47`）。行分两类：

- **结构合同**（`blocking: true`）：space 单调、size 5 档 8 步、radius = (n−1)×base、字号 = base+steps、行高/字距固定、duration/loop/delay 公式、easing 合法/镜像/t 范围、shadow 4 档三槽、occlusion 4 档、无语义节点、模式值两端完整、无载体语法、surface.canvas 不透明、scrim 单值、单墨、状态 target hover/pressed/disabled（`src/contracts.ts:163-370`）。
- **颜色报告**（`blocking: false`）：由 `colorRows` 把 `ColorResult.report` 的每一行转成合同行（`src/contracts.ts:144-156`），包括面阶、线、墨、色族文字/边框/前景、色相分离、不可达填充、端点偏离等。

`failed` 只数 `blocking && !pass`（`src/contracts.ts:374-375`）；颜色偏差只进 manifest 和诊断 warn，不会让构建失败。这是很关键的分级：结构错误必须阻断，颜色是设计取舍，允许 `contrastAllow` 把 deviation 降为 warn（`src/model/color/derive.ts:939-945`）。

### 3.3 五类静态守卫

`scripts/check-model.ts` 不跑构建，只扫源码：

1. **core-dependency**：`node:` 之外的非相对 import 只允许 `@ultime/studio` 在 `src/studio/**`、`@ultime/cli` 在 `src/cli/**`；
2. **core-scope**：相对 import 不得逃出 `src/`；
3. **model-direction**：`model/**` 不得 import `build` / `exporters` / `tools` / `studio` / `contracts` / `index`；
4. **category-isolation**：`model/<category>/**` 之间不得互相 import；
5. **model-forbidden-token**：把默认 seed 构建出的树序列化，禁止 `var(` / `color-mix` / `--[a-z]` 出现（`scripts/check-model.ts:38-82`）。

### 3.4 产物同源：`build --check`

`scripts/build.ts:38-48` 在 `--check` 模式下不写盘，把内存生成的每个文件与磁盘内容做字符串比较；不一致就列出 drift 并以退出码 1 结束（`:73-80`）。`pnpm check` 把它串在 `vp check && tsx scripts/check-model.ts && tsx scripts/build.ts --check` 后面（`package.json:84`）。

### 3.5 一条合同行长什么样

`row()` 把所有检查归一到同一结构（`src/contracts.ts:58-76`）：`id`（如 `space-monotonic`）、`blocking`、`pass`、`actual`、`target`、`message`。这样 CLI 只需要判断 `blocking && !pass`，不需要知道每条规则的具体逻辑；`inspect --json` 也能原样输出，让上层工具按 `id` 聚合。

`monotonic(values, step)` 检查“严格递增且每步相等”，`nearly(a,b)` 用 0.01 容差比较浮点，`bezierValid` 检查四个控制点的 x 在 `[0,1]`、y 不限，`easingFamilyValid` 额外检查 `standard` 首尾与对称、`accelerate` 是 `decelerate` 的镜像、`decelerate` 的 d1=0、`s1=0`、`s3=1`（`src/contracts.ts:78-104`）。这些辅助函数都是纯函数，测试可以直接喂边界值，不需要先构建整棵树。

### 3.6 诊断如何汇入 CLI 与 studio

`planProject` 把合同行转成 `BuildDiagnostic[]`：`code` 是 `contract.${id}`，`level` 由 `blocking` 决定，`path` 固定 `/tokens/seed`（`src/tools/project.ts:53-62`）。CLI 的 `build` 在 `errors.length > 0 || contracts.failed > 0` 时退出 1（`scripts/build.ts:82-83`）；`inspect` 则是只读，把诊断打印出来但不影响退出码。

studio 的 `validate` 做了两层裁剪：先只保留 `contract.*` 与 `other` 两组，再把合同组截前 12 条（`src/studio/index.ts:150-155`）。这是产品判断——配置器 UI 一次显示 133 条合同没有意义，先让用户看到最靠前的失败，再让他主动展开。注意这意味着 **studio 的 validate 不等于 CLI 的 build 门禁**：前者可能只显示 12 条，后者按全部 `failed` 判断。

### 3.7 新增一条合同要改哪几处

假设要加一条“`space` 的最大档不得小于 120”。正确路径是：

1. 在 `auditContracts` 里用 `rows.push(row('space-max', true, max >= 120, max, '>= 120', '...'))` 追加一行（`src/contracts.ts:163-173` 是现成的 space 段）；
2. 决定 `blocking`：这是结构规则，应设 `true`；
3. 如果要让 CLI 输出可读，`row` 的 `message` 要写“实际/目标”；
4. 在 `tests/core.test.ts` 加一个坏 seed，断言 `failed > 0` 且 `ids` 含 `space-max`；
5. 更新 `README` 或 `rules/README.md` 的合同说明（如果对外承诺了合同列表）。

不要做的是：把新规则塞进 exporter（出口不该知道业务规则）、或只在测试里断言（CI 不会在每个 seed 上跑）。合同是“对所有 seed 都成立”的规则，测试只是抽样；两者的职责不同。

## 4. 代码证据

| 证据 | 说明 |
| --- | --- |
| `src/build.ts:57-94` | 纯函数装配点：输入输出都可序列化，无 I/O、无时间 |
| `src/tools/project.ts:65-115` | 一次 `buildCore` 产出 core / manifest / artifacts / diagnostics |
| `src/contracts.ts:159-375` | 133 行合同生成；`failed` 只数 blocking |
| `src/contracts.ts:144-156` | 颜色行统一 `blocking: false` |
| `scripts/check-model.ts:38-82` | 五类静态守卫与默认树序列化检查 |
| `scripts/build.ts:38-48` | `--check` 逐字节比对，不写盘 |
| `src/build.ts:96-127` | manifest 无时间戳/绝对路径，只留版本、seed、seedHash、motion、counts、contracts、color |

## 5. 复杂度与边界条件

- **合同成本**：`auditContracts` 在树构建后跑一次；`semanticNodes` / `modeCompleteness` / `carrierSyntax` 各遍历整棵树一次，`countByCategory` 再遍历一次。对 274 个 token 是常数级，真正的成本在颜色派生（见 05）。
- **合同行数不等于合同类数**：133 行 / 34 类，颜色报告会按“族 × 模式 × 面”重复，所以看到 `total: 133` 不要以为有 133 条独立规则。
- **`failed` 的语义很窄**：只统计 `blocking && !pass`；颜色 deviation 不会让 `failed > 0`，必须看 `manifest.color.levels` 或诊断。
- **静态守卫不是 AST**：`check-model.ts` 用正则匹配 import，对 `import(variable)`、`require()`、类型层 re-export 等写法覆盖有限；`categoryOf` 只识别 `model/<category>/` 子目录，`model/skeleton.ts` / `model/light.ts` / `model/motion.ts` 这类单文件类别实际上不受 `category-isolation` 保护（`scripts/check-model.ts:33-36`、`:66-69`）。这是已知盲区。
- **FNV-1a 只有 32 位**：`seedHash` 用于指纹，不用于安全；碰撞概率不是零（`src/seed.ts:237-246`）。
- **诊断路径不精确**：`contractDiagnostics` 把所有合同错误的 `path` 都写成 `/tokens/seed`（`src/tools/project.ts:53-62`），颜色合同的定位仍要靠 `pair` 文本。

## 6. 取舍与局限

1. **合同与模型耦合**：合同直接 import `SkeletonResult` / `ColorResult` 等模型类型（`src/contracts.ts:13-19`），模型改字段会同时改合同；好处是“同一份事实”不被复制，代价是模型 API 不是稳定边界。
2. **颜色合同是报告不是门禁**：`tone-fill-unreachable` / `hue-separation` 等只影响 `level`，不影响 `failed`；如果团队把“颜色必须全 pass”当发布条件，需要自己读 `manifest.color.levels` 并加门禁。
3. **`--check` 是字符串比较**：能发现任何字节变化，也会把“仅换行/格式化”的变化当成 drift；这是有意的（生成物必须同源），但会让格式化工具与生成器互相打架。
4. **`tokens.json` 的 `schemaVersion: '4.0.0'` 与内核 `6.0.0` 不一致**（`src/exporters/json.ts:32`、`src/version.ts:8`），说明“版本单一来源”还没有做到所有出口；这是当前代码的真实遗留。
5. **没有外部 benchmark**：守卫与合同本身没有性能预算，构建变慢不会让 CI 失败；只有人工观察。

## 7. 我能偷什么

- **把“架构约束”写成可执行检查**：哪怕只是 90 行正则 + 序列化检查，也比一份“请遵守分层”的文档更能防止回退。
- **合同分级**：结构错误阻断、设计偏差只报告；不要把“颜色不完美”与“半径公式破了”混成同一个失败级别。
- **单一构建事实**：让 CLI、配置器、脚本共享一个 `ProjectBuild`，比让每个入口各自调用 `buildCore` 更不容易漂移。
- **产物同源检查放进 CI**：`--check` 不写盘，只比较；这是生成器项目最划算的一条防线。
- **manifest 去掉时间戳**：可复现的构建记录不包含“什么时候构建的”，只包含“用什么输入、什么版本、什么结果”。

**一句话记住**：这个项目的“守卫”不是测试套件的别名，而是把模型约束、依赖方向和产物同源都变成退出码——构建失败比评审记忆可靠。
