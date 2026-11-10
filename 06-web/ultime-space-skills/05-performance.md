# 05 性能：一次 CLI 扫描的真实成本在哪里

> 这篇回答什么问题：`codecraft check` 扫一个仓库要多久、随文件数怎么增长、慢在哪一步、什么情况下会漏扫？给出的都是实测值，不是估算。

## 先界定「性能面」

这个项目没有服务、没有守护进程、没有数据库。唯一的运行时性能面就是 **Codecraft CLI 的一次性扫描**：进程启动 → 遍历文件 → 逐文件读文本跑规则 → 汇总输出。所以性能问题的本质是「一次仓库扫描的吞吐与延迟」，不是 QPS、连接池或缓存命中率。

测试环境：Windows 11、Node v24.13.1、本地 SSD、源码 commit `624e48b`。合成仓库每个文件写一行 `import ... from '../../external/api'` 加一个空 catch，保证 A17 与 A6 都命中；调用 `check(root, {pack:'app'})`，不含进程启动。数字取两轮，波动来自文件系统缓存与 GC。

## 实测：文件数与耗时

| 文件数 | 第一轮 | 第二轮 | findings |
|---|---|---|---|
| 200 | 540 ms | 644 ms | 400 |
| 1,000 | 3,651 ms | 3,420 ms | 2,000 |
| 3,000 | 13,434 ms | 14,464 ms | 6,000 |

近似线性增长，约 **3.4–4.8 ms/文件**。200 → 1,000 是 5 倍文件、约 6 倍耗时，说明固定开销之外还有轻微超线性（目录层级、`seen` Set、findings 数组增长）。3,000 文件 14 秒，对「每次 CI 全量扫」是可感知但可接受的量级；对「保存即扫」的编辑器集成则太慢。

另外两个基线：

- **进程启动约 0.7–0.8 秒**（Node 空进程实测 769 ms，Windows）。所以几十个文件的小仓库，总耗时几乎全是启动成本。
- **自仓库 self-check**：`scanned=7`、A21 `scanned=61`（`skills/codecraft/package.json` 的 `self-check` 脚本只扫 `design-system` 包自身，`--exclude "evals/fixtures/**"`）。这说明默认排除策略把仓库自身的大部分内容挡在扫描面之外，也说明 coverage 数字必须和「扫了哪些 pack」一起读。

## 慢在哪：每个文件被读三次

`checkApp` 的流程是（`skills/codecraft/src/check.mjs:183-202`）：

1. `collectAppFiles` 遍历出候选文件；
2. 对每个文件调 `isMinified(file)` —— **完整读一次**，只为了判断「≤3 行且某行 >1000 字符」（`check.mjs:626-632`）；
3. `scanAppFile` 再读一次，跑 A6/A17 与生成物检查（`check.mjs:483-506`）；
4. 循环结束后 `scanSecrets` 第三遍遍历，对 A21 的扩展名集合（比 JS/TS 多）再读一次（`check.mjs:634-677`、`:34-46`）。

也就是普通 JS/TS 文件至少 3 次 `readFileSync`，A21 还要多扫配置/后端源码。磁盘缓存热时读本身不贵，但三次 `split('\n')`、三次正则扫描是实打实的 CPU。**推断：** 把 `isMinified` 的判断并进 `scanAppFile` 的首次读取，可省掉约 1/3 的读与行切分开销；这是最值得做的优化，但在 200 文件规模下收益只有百毫秒级，作者显然选择了「结构清晰优先」。

正则规则本身是逐行的：`scanAppFile` 对每一行依次跑 A6 的空 catch 正则、A17 的 import 正则（`check.mjs:508-524`）。规则数固定（app 3 条、library 4 条），所以是 O(行数 × 规则数)，没有跨文件分析，也没有二次方路径。

## 内存与输出

- `findings` 是普通数组，每条含 rule/file/line/message/severity；3,000 文件全违规时 6,000 条 findings，内存占用在几十 MB 量级，不会成为瓶颈。
- `coverage` 用 Set 记录 `unsupported` 扩展名，规模受扩展名种类限制，不随文件数增长。
- SARIF/JSON 输出会把全部 findings 序列化到内存再写 stdout；超大仓库接 `--format sarif` 时输出体积可能达到数 MB，建议重定向到文件而不是管道给终端。

## 有意为之的「少扫」

性能也靠不扫。代码里有四层过滤，且每一层都计入 coverage，避免「0 findings」被误解为「全绿」：

1. **目录跳过**：`SKIP_DIRS` 18 类（node_modules、dist、build、.next、.git、.claude、.cursor 等），见 `check.mjs:5-24`。
2. **扩展名限制**：主扫描只收 8 种 JS/TS 扩展名（`check.mjs:27`）；A21 用更宽的 `SECRET_EXTENSIONS` 扫配置与后端源码（`check.mjs:34-46`）。
3. **压缩产物跳过**：≤3 行且存在 >1000 字符的行，视为构建产物跳过，计入 `skippedMinified`（`check.mjs:626-632`）。
4. **`--changed` / `--since`**：只扫变更文件，CI 增量场景把输入从「全仓」降到「本次 diff」；CI 环境下 0 变更会 exit 2 而不是静默通过（`skills/codecraft/src/cli.mjs:176-210`）。

`--exclude` 支持 glob 且计入 `skippedByExclude`，是用户侧最有效的降本手段：把生成目录、第三方 vendor、测试快照排除掉，往往能减少一半以上文件。

## 与其他环节的成本对比

- **`release-check`**：要跑 `npm pack --dry-run`，npm 自身会遍历一次包目录并计算打包清单，再加上对每个文本文件的内容扫描（`check-package-content.mjs:77-95`）。对 200 文件级包是秒级，和 `npm pack` 本身同一量级。
- **`npm test`**：codecraft 116 个用例、eval 19 个 case，跑真实 CLI `spawnSync`（`evals/run.mjs`），是发布链路里最慢的一步；CI 里 test → eval → self-check → pack 串行，单 job 通常几分钟。
- **门禁（gates）**：`runGate` 默认超时 120 秒、`maxBuffer` 10MB（`gates.mjs:204-249`）；gate 本身跑项目的 typecheck/test，通常是整条链路最慢的部分，Codecraft 只负责编排和汇总，不重复执行。

## 边界与待查实

- **未测**：10,000 文件以上的规模、网络文件系统、机械硬盘、Node 20（CI 用 Node 22，本地用 Node 24）。这些条件下绝对值会明显不同，但线性趋势应保持。
- **跨平台差异**：Windows 上 `path.relative` 返回反斜杠，会影响 JSON/SARIF 里的路径字符串（见 07 的「可移植性」一节），但不改变扫描耗时。

## 结论

Codecraft CLI 的性能模型很简单：**一次性进程、线性扫描、每文件多读一遍、靠跳过目录和扩展名控制输入**。它适合「CI 全量/增量扫」和「本地手动检查」，不适合「编辑器保存即扫」或「万文件级分钟级门禁」。优化优先级是合并三次读 → 复用已读文本 → 再并行化；但在典型仓库规模下，收益最大的仍是「用 `--changed` 缩小输入」。
