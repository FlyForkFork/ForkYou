# 05 · 性能：不是性能型项目，但扫描器有明确的成本模型

> 这篇回答什么问题：Codecraft CLI 在一次检查里把时间花在哪？文件遍历、规则匹配、密钥扫描、gate 执行的复杂度与常量是什么？哪些跳过设计真的省时间，哪些只是「报告层过滤」？

## 结论先行

这不是性能型项目：没有服务、没有索引、没有并发，CLI 是**单进程同步 I/O**，目标是在普通项目上「秒级出结果」。它的性能设计不是优化吞吐，而是**用跳过策略控制扫描面**：18 类目录不进入、8 种扩展名才收、测试文件跳过、压缩产物跳过、`--exclude` 可再加一层。代价是覆盖率下降，所以每次跳过都写进 `coverage`，让「0 findings」可解释（`skills/codecraft/src/check.mjs:145-181`）。

## 性能敏感路径

| 路径 | 位置 | 成本 |
|---|---|---|
| 文件遍历 | `walk`（`skills/codecraft/src/check.mjs:425-454`） | O(F)，每个目录 `readdirSync` 一次，`seen` 防重复 |
| 文件读取 | `isMinified` / `scanAppFile` / `scanSecrets` | 同一文件可能被读 1–3 次，没有跨阶段缓存 |
| 规则匹配 | `scanAppFile` / `scanPackage` | 每条规则对全文做正则/字符串匹配，O(字节数) |
| 密钥扫描 | `scanSecrets`（`skills/codecraft/src/check.mjs:634-677`） | 额外遍历一次全仓，6 组模式 + 赋值解析 |
| gate 执行 | `runGate`（`skills/codecraft/src/gates.mjs:204-249`） | `spawnSync` 阻塞等待，成本由外部命令决定 |

## 复杂度

设 F 为被扫描文件数、B 为总字节数、R 为规则数（app 3 条、library/design-system 4 条）：

- **遍历**：O(F)，每个目录项一次 `readdirSync`；`seen` 集合避免符号链接/重复目录导致指数级递归。
- **读取与匹配**：O(R × B)，规则是常量级正则；没有 AST、没有类型检查、没有跨文件依赖图。
- **密钥扫描**：额外 O(F) 遍历 + O(B) 正则；`seen` 以 `file:line` 去重，避免同一位置重复报。
- **空间**：findings 数组 + coverage 的几个计数器/Set；不缓存文件内容，不建索引。
- **gate**：O(G × T)，G 为 gate 数，T 为外部命令耗时；超时默认 120000ms，`maxBuffer` 10MB。

因此它在大仓库上的瓶颈通常是**文件系统遍历 + 重复读文件**，不是正则本身。单文件很小、规则很少时，Node 启动和 `readdirSync` 的系统调用占比更高。

## 关键常量与阈值

| 常量 | 值 | 位置 |
|---|---|---|
| 跳过目录 | 18 类：node_modules、dist、build、target、.git、.local、.venv、venv、coverage、.next、.nuxt、.output、.turbo、.cache、.agents、.trae、.claude、.cursor | `skills/codecraft/src/check.mjs:5-24` |
| 支持扩展名 | `.ts/.tsx/.js/.jsx/.mjs/.cjs/.vue/.svelte` | `skills/codecraft/src/check.mjs:27` |
| 压缩文件判定 | ≤3 行且存在单行 >1000 字符 | `skills/codecraft/src/check.mjs:626-632` |
| 生成物标记扫描 | 前 20 行 | `skills/codecraft/src/check.mjs:535-537` |
| 生成物头扫描 | 前 3 行 | `skills/codecraft/src/check.mjs:539-541` |
| 明文密钥值最短长度 | 6 字符 | `skills/codecraft/src/check.mjs:690-701` |
| gate 默认超时 | 120000ms | `skills/codecraft/src/gates.mjs:224-231` |
| gate 输出缓冲 | 10 × 1024 × 1024 字节 | `skills/codecraft/src/gates.mjs:224-231` |

## 哪些跳过真的省时间

- **`SKIP_DIRS`**：在遍历阶段直接不进入，省掉整棵子树的 `readdir` 与读取；对 `node_modules` 这种动辄几万文件的目录是数量级差异。
- **扩展名过滤**：在 `walk` 里就丢弃非 JS/TS 文件，不读内容；`coverage.unsupportedExtensions` 记录被忽略的扩展名。
- **测试文件跳过**：`isTestFile` 在遍历阶段判断并计数，不进入规则匹配（`skills/codecraft/src/check.mjs:621-623`）。
- **压缩产物跳过**：先读文件判断行数/单行长度，再决定是否扫描；对小文件成本低，对大 bundle 能避免大量无意义正则。
- **`--exclude`**：在 `checkApp` / `checkPackages` 的入口过滤，不进入后续扫描（`skills/codecraft/src/check.mjs:253-263`）。

## 哪些「不报」并不省时间

- **`ignore`**：先扫描、后过滤。它减少的是报告噪音，不是扫描成本；过期条目还要额外计算。
- **`baseline`**：同样是扫描后抑制；`--update-baseline` 还要把 findings 排序写入文件。
- **`--changed` / `--since`**：README 明确写了「底层仍做全量扫描，只过滤 findings」（`skills/codecraft/README.md:312`）。它省的是人的注意力，不是 CPU。
- **`--rules`**：会收窄报告与 coverage，但 `check()` 仍按 pack 跑完整规则集；除非未来在扫描前按规则裁剪。

## 优化与反例

**值得做的**（如果将来要扫超大 monorepo）：
1. 在 `walk` 前按 `--exclude` 剪枝，而不是遍历后再过滤；
2. 缓存单次读取的文件内容，避免 `isMinified` / `scanAppFile` / `scanSecrets` 重复读；
3. 把密钥扫描与结构扫描合并到同一次遍历；
4. gate 已是外部进程，瓶颈在命令本身；先优化 typecheck/test，而不是优化 `spawnSync`。

**不值得做的**：
- 为了「更快」引入 AST / TypeScript 编译器：启动成本和依赖体积会远超收益，且与「零运行时依赖」的定位冲突。
- 为 CLI 加并发：同步 I/O 在普通项目上是毫秒级，Node 线程池/worker 的复杂度不划算。
- 用缓存换正确性：规则依赖文件内容与配置，缓存失效逻辑容易引入「扫了旧代码」的假阴性。

## 实测说明

本次分析**没有做基准测试**：项目不是性能型，仓库本身只有 192 个文件，跑基准的结论不可外推到用户项目。若要测，建议用固定 commit、固定 Node 版本，记录：

```bash
node --version
/usr/bin/time -v node skills/codecraft/bin/codecraft.mjs check --root <大型项目> --pack library
```

并同时记录 `coverage.scanned`、`coverage.skipped*`，否则「快」可能只是跳过得多。

> 一句话记住：**Codecraft 的性能策略是「用跳过控制扫描面，用 coverage 暴露代价」；ignore/baseline/--changed 都是报告层过滤，不省扫描时间。**
