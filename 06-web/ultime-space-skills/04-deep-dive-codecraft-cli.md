# 04 深挖 · Codecraft CLI：静态扫描、规则包、豁免与门禁

> 这篇回答什么问题：`codecraft check/audit/plan/init` 到底怎么工作？它如何在不做 AST、不引依赖的前提下，把「代码宪法」变成可解释的 findings、可执行的 gate 和可上传的 SARIF？

## 问题是什么

代码规范类工具通常死在两个极端：要么只有文档，agent 看完还是各写各的；要么只有 lint，规则零散、无法解释「为什么」。Codecraft CLI 走第三条路：**规则有 ID（A1–A21），检查只覆盖高置信子集，输出带 coverage 与证据，门禁可编排但不复制项目自己的 typecheck/test**。

它要解决的不是「发现所有问题」，而是「让每次检查的结论可复核、可阻断、可收敛」。

## 朴素做法为什么不够

- **纯 ESLint**：能管语法和风格，管不了「pages 不许 import external/」「生成物必须标勿手改」这类架构约束；规则 ID 也和宪法对不上。
- **纯文档 + code review**：无法进 CI，无法量化存量，无法证明「这次真的没新增」。
- **一次性全量阻断**：老项目一跑几千条，团队第一天就关掉门禁。
- **忽略一切**：`ignore` 没有理由和到期日，最后变成永久豁免；密钥若也能 ignore，安全红线直接失效。

## 核心机制

### 1. 四个命令，职责单一

- `check`：默认命令，只跑内置静态规则（`skills/codecraft/src/cli.mjs:79-96`）。
- `audit`：同样跑静态规则；gates 只有显式 `--run-gates` 才执行，未执行会在 stderr 告警（`skills/codecraft/src/cli.mjs:267-282`）。
- `plan`：把 findings 转成只读升级计划，每条带修复动作、验证命令、宪法条款出处（`skills/codecraft/src/plan.mjs:29-41`）。
- `init`：生成 app/library 骨架；默认 dry-run，`--apply` 才写盘且必须给 `--name`（`skills/codecraft/src/init.mjs:21-98`、`skills/codecraft/src/cli.mjs:113-121`）。

### 2. 规则包决定「查什么」

`PACK_RULES` 硬编码三套：`app` = A6/A17/A21，`library` 与 `design-system` = A2/A6/A11/A21（`skills/codecraft/src/cli.mjs:23-27`）。

`--pack auto` 用目录标记推断：有 `apps/`、`src/pages`、`pages/`、`app/` 或 Nuxt/Taro/uni-app 标记 → app；有 `packages/` 或 `src/` → library；否则 app（`skills/codecraft/src/cli.mjs:590-598`）。`design-system` 不参与自动判定，必须显式传。

`--rules` 只是 pack 的**过滤器**（交集），不是新规则集。全部规则都不在 pack 内时 exit 2，注释写得很直白：「照常跑会 0 findings 变绿，静默废掉门禁」（`skills/codecraft/src/cli.mjs:157-175`）。

### 3. 静态扫描：文件遍历 + 文本级规则

`check()` 按 pack 分派到 `checkApp` / `checkLibrary` / `checkDesignSystem`（`skills/codecraft/src/check.mjs:134-143`）。`walk` 是 DFS，带 `seen` 集合防重复，跳过 `SKIP_DIRS` 的 18 类目录（node_modules、dist、build、.git、.next、.claude、.cursor、.agents、.trae 等），只收 8 种 JS/TS 扩展名（`skills/codecraft/src/check.mjs:5-27`、`:425-454`）。

规则本身是文本级：

- **A17**：内部文件 import `external/` 或 `generated/`；`Wrapper/API/adapters` 目录放行，`boundaries.allowedImporters` 可单独登记（`skills/codecraft/src/check.mjs:483-506`、`:589-594`）。
- **A6**：空 catch、注释-only catch、只返回 `null/undefined/{}` 的 Promise handler（`skills/codecraft/src/check.mjs:98-132`）。
- **A2**：包不 import app、相对路径不逃逸、workspace 依赖必须声明（`skills/codecraft/src/check.mjs:285-366`）。
- **A11**：生成物必须有「勿手改/派生」标记，只看前 3 行（`skills/codecraft/src/check.mjs:526-541`）。
- **A21**：私钥、AWS/Aliyun/GitHub/Slack/OpenAI 风格 token、明文赋值；命中的 finding 带 `critical: true`，报告置顶（`skills/codecraft/src/check.mjs:58-65`、`:634-677`）。

A21 的 severity 仍是 `warn`，`critical` 是独立标记——代码注释解释了为什么不用 `error`：「severity 只表示阻断力度（--ci 才升 error），用 critical 独立标记，报告置顶，不改变既有语义」（`skills/codecraft/src/check.mjs:648-656`）。

### 4. ignore 与 baseline：两种「不报」，两种约束

`ignore` 是逐条例外：必须给 `rule`、`file`、`reason`，可选 `expires`（YYYY-MM-DD）；**A21 直接抛错**，因为安全红线不可豁免（`skills/codecraft/src/ignore.mjs:25-29`）。过期条目不生效，并单独列在 `Expired Exceptions`（`skills/codecraft/src/ignore.mjs:54-84`）。路径匹配支持 `*` / `**` / `?`，无通配符时按精确路径或目录前缀（`:87-99`）。

`baseline` 是存量快照：指纹 = `rule|file|message`，不含行号，路径统一 `/`，因此编辑代码不会让基线全量失配（`skills/codecraft/src/baseline.mjs:13-16`）。`--update-baseline` 默认「只减不增」：新增条目会被拒绝（exit 2），除非 `--force`；critical 密钥永远排除在基线之外（`skills/codecraft/src/cli.mjs:219-221`、`:372-411`）。基线文件缺失时只告警、不抑制，不会静默变绿（`skills/codecraft/src/cli.mjs:224-245`）。

### 5. gates：只编排，不复制

Gate Contract 2.0 的字段是 `id` / `entry` / `args` / `files` / `exclude` / `output` / `threshold` / `timeoutMs`。`validateGates` 会拒绝 1.x 的 `run`/`name` 并打印迁移示例（`skills/codecraft/src/gates.mjs:89-139`），还拒绝「有 threshold 却没有 output」——因为没 output 就解析不出 issue 数，会变成永久失败（`:122-126`）。

执行时 `spawnSync` 带 `shell: true`，注入 `CI=1`，默认超时 120000ms、`maxBuffer` 10MB；输出全文捕获后先脱敏再进报告（`skills/codecraft/src/gates.mjs:204-249`）。

阈值是 fail-closed 的：只认 `metric: issues` 与 `< <= > >= ==`；解析不出实际 issue 数时 `actual=null`、`violated=true`，宁可失败也不放过（`skills/codecraft/src/gates.mjs:169-185`）。`isGateFailed` 把「退出码非 0」或「threshold.violated」视为失败，但 `skipped` 的 gate 不算失败（`:188-191`）。

### 6. SARIF：给 GitHub Code Scanning 的出口

`formatSarif` 输出 SARIF 2.1.0：`driver` 里列规则元数据，结果按 `critical || severity==='error'` 映射成 `error`，其余 `warning`（`skills/codecraft/src/cli.mjs:699-740`）。`SARIF_RULES` 只有五条内置规则的映射（`:742-748`）；自定义规则不在表里时不会自动获得语义。README 明确写了「SARIF 的级别只影响 Code Scanning 的展示与它自己的门禁，不改变本工具的退出码」（`skills/codecraft/README.md:311`）。

## 代码证据（8 处）

1. `skills/codecraft/src/check.mjs:5-27`：`SKIP_DIRS` 18 类目录 + 8 种扩展名，决定扫描边界。
2. `skills/codecraft/src/check.mjs:425-454`：`walk` 的 DFS + `seen` 去重 + 测试文件跳过计数。
3. `skills/codecraft/src/check.mjs:183-203`：`checkApp` 先排除、再跳压缩文件、再收集生成物、最后扫描；末尾单独调 `scanSecrets` 做第二遍遍历。
4. `skills/codecraft/src/cli.mjs:23-27`：`PACK_RULES` 是规则集唯一来源，`--rules` 只能取交集。
5. `skills/codecraft/src/cli.mjs:157-175`：`--rules` 全部不在 pack 内时 exit 2，防「0 findings 静默变绿」。
6. `skills/codecraft/src/ignore.mjs:25-29`：A21 不能 ignore，安全红线在配置校验层拦住。
7. `skills/codecraft/src/baseline.mjs:13-16`：指纹不含行号、路径归一化，是 baseline 可维护的关键。
8. `skills/codecraft/src/gates.mjs:169-185`：threshold 解析失败即视为违反，fail-closed。

## 复杂度与边界

- **时间**：文件遍历 O(F)；每个文件被读 1–3 次（`isMinified`、`scanAppFile`、`scanSecrets` 各自读），整体约 O(F×R)，R 为规则数（最多 4 条），无跨文件索引或全局图计算。
- **空间**：findings 数组 + coverage Set；A21 的 `seen` 以 `file:line` 去重；没有缓存大对象。
- **跳过策略**：`SKIP_DIRS`、`--exclude`、测试文件、压缩文件（≤3 行且某行 >1000 字符）都会减少实际扫描量，且这些跳过会计入 coverage 而不是无声消失（`skills/codecraft/src/check.mjs:164-181`）。
- **硬边界**：纯文本级，不解析 AST、不做类型分析；动态 handler、运行时路径解析、条件导入都可能漏报（`skills/codecraft/src/check.mjs:156-162` 的 `RULE_LIMITATIONS` 就是这段话的机读版）。
- **安全边界**：gate 是任意 shell 命令，只能来自可信配置；fork PR 不应跑 `audit --run-gates`（`skills/codecraft/docs/shared/04-gates.md`）。

## 取舍与局限

1. **零依赖换覆盖率**：不用 TypeScript 编译器 / AST，换来安装零依赖和极低启动成本，但 A2/A17 只能做文本匹配，复杂 monorepo 可能误报。
2. **保守跳过换信噪比**：跳过测试、压缩产物、生成目录减少重复报错，但也意味着「没扫到」不等于「没问题」；coverage 字段就是为此存在。
3. **baseline 只减不增**：避免基线变成垃圾场，代价是修复节奏慢时必须显式 `--force` 重建。
4. **gate 默认关闭**：2.0 把 `audit` 的隐式执行改成显式 `--run-gates`，牺牲便利换「不会在不知情时执行任意命令」。
5. **SARIF 映射有限**：只有五条规则有语义映射，新增规则必须同步 `SARIF_RULES`。
6. **报告模式默认不阻断**：不带 `--ci` 时即使有 findings 也返回 0；接 CI 时忘加 `--ci`，门禁等于没接。项目用 README 的接入档位表反复强调（`skills/codecraft/README.md:119-128`），属于「用文档补产品默认值」的取舍。

## 我能偷什么

- **「规则 ID + 可机检子集 + coverage」三件套**：任何团队规范都可以先固定 ID，再只自动化高置信部分，剩余明确写「人工评审」，比假装全自动可信。
- **ignore 与 baseline 分开**：例外是逐条、有理由、有到期；存量是整批、只减不增。两种「不报」混在一起，治理一定烂掉。
- **fail-closed 的 threshold**：解析不出结果就判失败，适合所有「外部工具输出 → 门禁」的场景。
- **gate 只编排**：不复制 typecheck/test，只负责调用、超时、脱敏、汇总；这是最小侵入的 CI 集成。
- **报告先脱敏**：gate 输出可能带 token/连接串，先替换再拼报告，成本极低但能避免二次泄露。
- **critical 不复用 severity**：安全红线用独立字段表达，不污染「阻断力度」这一维语义。

> 一句话记住：**Codecraft CLI 的价值不在「查得多」，而在「查得可解释、可收敛、可阻断」——规则 ID、coverage、ignore 到期、baseline 棘轮、fail-closed threshold，五件套缺一不可。**
