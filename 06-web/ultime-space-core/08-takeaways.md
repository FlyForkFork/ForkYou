# 08 · 能带走什么：把“生成设计系统”当成一门工程

**这篇回答什么问题**：如果只给你 30 分钟讲这个仓库，哪些设计值得抄回自己的项目、哪些只是它自己的选择、面试被追问时该怎么答。

> 说明：RULES 要求 08 走“面试官 + 面试者”双 Agent 模拟。本次运行环境 `delegation depth = 0`，`subagent` / `subagent_fork` 均不可调用，因此题目与答案是**单 Agent 自拟**（主 Agent 先按 deep 档出题，再切换视角作答），不是双 Agent 产物。此限制已写入 `meta.json.analysis.skipped`。

## 一、可迁移想法（6 条）

### 1. 存“意图”，不存“结果”

- **问题**：token 清单被手改后，没人知道 `--space-7: 28px` 是谁定的。
- **做法**：seed 只存 `primaryHue`、`radius.base`、`fontSize.steps`、`light.altitude` 这类意图，274 个值由 `buildCore` 现算（`src/build.ts:57-94`）。
- **为什么好**：一份事实一个来源；改一个数，整棵树连带重算，`build --check` 挡住手改快照（`scripts/build.ts:38-48`）。
- **怎么用到我的项目**：任何“配置 → 大量派生文件”的场景，把派生结果标成生成物，意图单独存，CI 跑 `--check`。

### 2. 把设计规范写成可执行合同

- **问题**：间距单调、字号档差、动效公式写在 wiki 里，没人执行。
- **做法**：`auditContracts` 生成 133 行、34 类合同，`blocking` 失败让构建退出 1，颜色偏差只降级为 warn（`src/contracts.ts:159-375`、`:374-375`）。
- **为什么好**：规范从“评审意见”变成“退出码”；分级让“色域不可达”和“半径公式破了”不混为一谈。
- **怎么用到我的项目**：给生成物写结构断言（排序、单调、唯一、引用完整），blocking 进 CI，启发式只报警。

### 3. 用正确的色彩空间，再谈对比度

- **问题**：在 sRGB 上按比例调亮调暗，色相会漂、饱和度会塌。
- **做法**：色相/chroma 走 OKLCH，明度用 WCAG 对比度反解，`chromaMax` 二分把颜色夹回 sRGB（`src/model/color/oklch.ts:72-86`、`math.ts:133-168`）。
- **为什么好**：三个空间各管一件事；色域裁剪显式，不会悄悄产出非法颜色。
- **怎么用到我的项目**：按品牌色生成色阶时，先换感知均匀空间，再用目标对比度反解明度，最后做色域映射。

### 4. 一个节点，多种出口形态

- **问题**：同一份 token，CSS 要 rem、JSON 要数字、DTCG 要 `$type/$value`，还要 light/dark。
- **做法**：模型只产 `{ $type, $value }`，不带载体语法；三个 exporter 各自决定单位、命名、模式拆分（`src/exporters/css.ts:180-186`、`dtcg.ts:67-96`）。
- **为什么好**：加出口不用改模型；`no-carrier-syntax` 合同保证模型里不混进 `var()` / `px`。
- **怎么用到我的项目**：领域模型与序列化层彻底分开，序列化可以多份、独立测试。

### 5. 选择是过滤器，不是重新生成

- **问题**：用户只要 4 档间距、3 档圆角，难道重跑构建？
- **做法**：`selectBuild` 消费已建好的 `ProjectBuild`，`selectTree` 纯过滤数字 key，`build.core` 保持全量（`src/studio/selection.ts:188-216`、`:219-283`）。
- **为什么好**：同一份构建可被多个选择复用；缓存 key 只含 `config.tokens`（`src/studio/index.ts:30-46`）。
- **怎么用到我的项目**：把“定制”实现成对成品的投影，而不是参数化重跑。

### 6. 派生只调引擎函数，不开沙箱

- **问题**：配置器想让用户选光影形态，最危险的是让用户写 recipe。
- **做法**：`deriveTree` 只接受 `light.form ∈ {flat, convex, concave}`，内部调 `build.core.light.solve` 重算 highlight/shade，不写回 seed（`src/studio/derivation.ts:34-89`）。
- **为什么好**：输入收敛成枚举，没有代码执行面；派生结果与静态树可并排比较。
- **怎么用到我的项目**：任何“让用户自定义派生”，先问能不能枚举；能枚举就别开 DSL。

## 二、面试卡（9 题，deep 档）

### Q1. 这个项目到底解决什么问题？为什么不是又一个 token 清单？

**30 秒答案**：它是“从意图生成设计系统”的编译器：输入 seed（品牌色、基准尺寸、光影参数），输出一棵树、133 条合同、四份产物。市面工具多在管清单——编辑、转换、发布；我把清单当派生结果，把意图和规则当源。换品牌只改 seed，规范和产物不会各说各话。

**追问**：团队已有一份 Figma token 清单怎么办？→ 待查实：仓库没有 Figma 导入器，只有 `init` 生成的 JSONC 配置和 seed 对象；迁移要自己写脚本反推 seed。

### Q2. 为什么合同要分 blocking 和 non-blocking？

**30 秒答案**：结构合同（间距单调、字号档差、圆角可推导、光影层数、模式完整、无载体语法）是确定性的，失败说明模型坏了，必须让构建失败；颜色合同是求解出来的，色域边界可能真的无解（比如某个 chroma 同时满足 7:1 和 sRGB），把偏差降级成 warn、把 `contrastAllow` 作显式豁免，比让构建随机失败更诚实。`failed` 只数 `blocking && !pass`，就是这个策略的落点（`src/contracts.ts:374-375`）。

**追问**：warn 会不会被忽略？→ 会。默认 seed 下 `pass: 106`、warn 为 0；一旦出现 warn，说明 seed 被调到了边界，要在 review 里看 `manifest.color.report`。

### Q3. 颜色求解为什么用固定步长扫描，而不是解析解？

**30 秒答案**：约束不是单一函数：明度要满足 WCAG 相对亮度（非线性），chroma 受 sRGB 色域限制，tone 还要落在 0.5 的离散网格上。解析解要处理分段边界，代码很难验证；固定步长（填充 201 步、alpha 0.005、coverage 0.002、色域二分 20 次）虽然慢，但每步可断言、可复现，出错能定位到采样点。代价是精度受步长限制，用 `+0.03` 余量吸收（`src/model/color/math.ts:183-191`）。

**追问**：性能怎么办？→ 实测 `buildCore` 约 90ms，274 个 token 够用；真要提速先缓存 `chromaMax` 的 `(tone, hue)` 结果，而不是换解析解。

### Q4. 为什么 manifest 里没有时间戳和绝对路径？

**30 秒答案**：因为产物要逐字节复现。`buildManifest` 只放版本、seed、seedHash、unit、motion、counts、contracts、color（`src/build.ts:96-127`）。写入 `new Date()` 或本机路径，同一份 seed 在两台机器上就会产生不同文件，`build --check` 立刻失效，git diff 也被噪声淹没。可追溯性用 `seedHash`（FNV-1a 32），不用时间。

**追问**：怎么知道产物什么时候生成？→ 看 git commit 和 CI 记录；manifest 刻意不承担这个职责，代价是线上排障少了时间线索。

### Q5. 0.7 的 selection / derivation 为什么放在 studio，而不是 core？

**30 秒答案**：因为它们是产品决策，不是模型事实。`buildCore` 永远产完整树；选择（要哪些档位）和派生（光影形态）属于配置器层；CLI 只读 `tokens` 区，不认这两个字段（`README.md:74-104`）。这样 core 的合同仍对全量树成立，selection 只是投影，不会让“裁剪后的树”变成第二种真相。

**追问**：用户直接调 `selectBuild` 绕过 studio 呢？→ 可以，它是导出函数；但它要求先有 `ProjectBuild`，`core` 保持全量，诊断里追加 `selection.*` / `derived`，不会伪装成一次独立构建。

### Q6. 一个 seed 让某个颜色目标不可达，系统怎么表现？

**30 秒答案**：不会崩，也不会静默通过。颜色报告会记一行 `deviation`，带 `pair` 和原因；如果 seed 显式写了 `contrastAllow`，这行降级成 warn（`src/model/color/derive.ts:916-945`）。合同层只把 blocking 失败算进 `failed`，所以构建仍能出产物，但 `manifest.color.levels` 的 pass 数会掉，`inspect` 能直接看到。

**追问**：这算“带病发布”吗？→ 算半个。颜色是设计取舍，硬失败会逼用户去改一个他改不动的色域约束；但默认 seed 是 106/106 pass，任何 deviation 都应是主动选择。

### Q7. 性能边界在哪？token 数翻 10 倍会怎样？

**30 秒答案**：瓶颈不在 token 数，在颜色反解的固定步长扫描。`buildCore` 约 90ms（本机实测，p95 160ms），颜色占大头；token 从 274 到 2740，树遍历和序列化线性增长，颜色部分基本不变（族数由 seed 决定）。真正的风险是族数（semantic + accent）增长，会让 `solveFillTone` 的 201 步扫描成倍增加。

**追问**：有 benchmark 吗？→ 没有。仓库没有性能测试，90ms 是探针脚本测的，不是官方数字；CI 也没有性能门禁。

### Q8. 这套架构最脆的地方是什么？

**30 秒答案**：三个。第一，合同有硬编码档数（`size-monotonic` 假设 5 档、`type-steps` 假设 9 档），改模型不改合同就会假失败（`src/contracts.ts:174-218`）；第二，静态守卫用正则而不是 AST，`category-isolation` 只识别 `model/<category>/` 子目录，`skeleton.ts` / `light.ts` / `motion.ts` 单文件不受保护（`scripts/check-model.ts:38-82`）；第三，`tokens.json` 的 `schemaVersion` 还硬编码 `4.0.0`，与内核 `6.0.0` 不一致（`src/exporters/json.ts:32`）。

**追问**：为什么不修？→ 第一个要引入“档位元数据”，第二个要上 TS AST（与零依赖冲突），第三个是纯遗留，改动会影响快照，需要一次专门的契约提交。

### Q9. 如果重做，你会改哪三件事？

**30 秒答案**：第一，把合同的档数假设抽成从模型读出的元数据，而不是写死；第二，`emitTokens` 按 `platforms` 懒构造，现在无论选哪个平台都先算三份字符串（`src/tools/tokens.ts:35-46`）；第三，给 `chromaMax` 加小缓存，因为 `solveFillTone` 的 201 步会重复求同一批 tone。前两个是正确性/效率，第三个是纯性能，优先级最低。

**追问**：会不会换 APCA？→ 待查实：仓库只用 WCAG 2.x（`src/model/color/math.ts` 的相对亮度公式），没有 APCA；换算法会改变全部 106 条颜色记录，属于契约级变更。

## 三、吹B一句话（4 条）

1. 我用一份 seed 生成了 274 个 token、133 条合同和四份产物，改一个色相，整棵树的对比度自动重算。
2. 我的构建没有时间戳、没有绝对路径，同一份 seed 在任何机器上逐字节一致，`--check` 能当门禁。
3. 我把设计规范写成了 34 类可执行合同，结构失败让 CI 红，颜色失败降级成可审计的 warn。
4. 颜色不是调出来的，是解出来的：OKLCH 管色相、WCAG 管明度、sRGB 做裁剪，106 条目标全 pass。

## 四、局限与不该抄的地方

- **别抄“单维护者 + 0.x 破坏”的发布节奏**：0.5.0 改光影名不提供迁移器，0.8.0 又在收紧出口；生产依赖要锁版本并预留迁移成本。
- **别抄硬编码档数的合同**：`size-monotonic` 假设 5 档，在你自己项目里会变成“改模型就假失败”的债务。
- **别抄正则版依赖守卫**：挡不住 `import()` 动态导入和类型层引用；要严就用 AST。
- **别抄 `tokens.json` 的 schemaVersion 4.0.0**：这是遗留 bug，不是设计。
- **别把 selection 当安全边界**：它只是过滤器，不校验 seed 合法性，也不防恶意输入。
- **色彩只覆盖 sRGB**：P3 / Display-P3 没有实现；做广色域要重写 `chromaMax` 这一层。

**一句话记住**：这个仓库最值钱的不是 274 个 token，而是“意图 → 派生 → 合同 → 可复现产物”这条链；把它抄进你的生成器，比抄它的颜色值有用得多。
