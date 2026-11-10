# 08 可迁移想法与面试卡

> 说明：面试卡基于 `624e48b` 的代码与文档证据整理。**本环境无法启动 subagent（深度上限），双 Agent 模拟面试未执行**，以下问答由主 Agent 自拟，答案逐条对应证据；无证据处标「待查实」。

## 一、可迁移想法

### 1. 入口只做路由，正文按需加载

- **问题**：skill 越写越长，模型每次都要读全文，上下文成本高，改一条规则还要动入口。
- **做法**：`SKILL.md` 只保留 frontmatter、适用场景、读法路由和模式表，规则正文全部放 `docs/`；codecraft 末尾直接写「规则正文只在 `docs/`；本文件只做入口」（`skills/codecraft/SKILL.md:102`）。
- **为什么好**：入口稳定、正文可独立演进；模型先读入口再按路由加载主题文档，token 花在真正相关的部分。
- **怎么用到我的项目**：把 `AGENTS.md` / `CLAUDE.md` 控制在 100 行内，只写「什么时候读哪个文件」，不写具体规则。

### 2. 规则 ID + 可机检子集 + coverage

- **问题**：团队规范写成文档没人看，写成 lint 又覆盖不全，最后「0 报错」被当成「没问题」。
- **做法**：宪法固定 A1–A21 共 21 条不变量，CLI 只机检其中高置信的 5 条（A2/A6/A11/A17/A21）；每次输出 `coverage`，列出扫了多少文件、跳过多少、哪些规则有文本级局限（`skills/codecraft/src/check.mjs:156-181`）。
- **为什么好**：不假装全自动；「没扫到」和「没问题」被明确分开，评审知道该补什么。
- **怎么用到我的项目**：给规范编号，标注「机检/人工」，CI 只阻断机检部分，人工部分进 review checklist。

### 3. ignore 与 baseline 分开治理

- **问题**：所有「不报」混在一起，例外会腐烂成永久豁免，存量问题永远还不完。
- **做法**：`ignore` 逐条、必须有 `rule/file/reason`，可设 `expires`，A21 直接拒绝豁免（`skills/codecraft/src/ignore.mjs:25-29`）；`baseline` 整批快照，指纹不含行号，`--update-baseline` 只减不增，critical 排除（`skills/codecraft/src/baseline.mjs:13-16`、`skills/codecraft/src/cli.mjs:372-411`）。
- **为什么好**：例外有期限、存量只降不升；两种「不报」各司其职，治理可审计。
- **怎么用到我的项目**：lint 豁免要求 `// reason + expiry`；历史债务用 baseline，禁止把新问题塞进 baseline。

### 4. 失败要 fail-closed，不要 fail-open

- **问题**：门禁解析不了外部工具输出时，最容易「当作通过」，于是门禁形同虚设。
- **做法**：`evaluateThreshold` 在 `actual == null` 时直接 `violated: true`（`skills/codecraft/src/gates.mjs:169-185`）；threshold 没有 `output` 在配置期就报错（`:122-126`）。
- **为什么好**：解析失败是「不确定」，不确定不能当「没问题」；错误在配置期暴露比在 CI 里静默放行好。
- **怎么用到我的项目**：所有「外部输出 → 判断」的桥接层，默认失败，只有明确成功才通过。

### 5. 发布前扫「真实打包清单」

- **问题**：`.npmignore` / `files` 只管打哪些文件，不管内容里有没有内部路径、内部包名、本地绝对路径。
- **做法**：`check-package-content.mjs` 用 `npm pack --dry-run --json --ignore-scripts` 拿真实清单，再逐文件扫六类禁入文件与三类内容规则；例外写进 `ALLOW` 并注明理由（`skills/codecraft/scripts/check-package-content.mjs:40-75`）。
- **为什么好**：检查对象就是用户实际拿到的东西；不会出现「仓库里没有、包里却有」的盲区。
- **怎么用到我的项目**：发布流水线加一步「对 pack 清单做内容扫描」，比维护手写白名单可靠。

### 6. 版本三方对齐 + tag 强校验

- **问题**：`VERSION`、`package.json`、`CHANGELOG`、git tag 四处各写一遍，发版总有一处对不上。
- **做法**：`VERSION` 为真源，`release-check` 校验它与 `package.json`、`CHANGELOG` 一致；发布 workflow 再用 `node -e` 校验 tag 与版本一致，`npm view` 查重（`skills/codecraft/scripts/release-check.mjs:20-34`、`.github/workflows/publish.yml:30-41`）。
- **为什么好**：错误在发布前暴露；tag 打错不会发出「版本与 tag 不符」的包。
- **怎么用到我的项目**：版本只留一个真源，其余全部派生 + 自动校验；发布前先查重。

### 7. 知识型 skill 也要有回归网

- **问题**：文档改一句话，看起来无害，但可能让 agent 的行为整体退化。
- **做法**：codecraft 有 19 个 eval case，`evals/run.mjs` 用 `spawnSync` 跑真实 CLI；发布 workflow 在 `npm test` 后必跑 `npm run eval`（`skills/codecraft/evals/run.mjs:1-87`、`.github/workflows/publish.yml:43-47`）。
- **为什么好**：单测保代码，eval 保行为；文档型项目尤其需要后者。
- **怎么用到我的项目**：给 prompt / skill 建 golden tasks，固定输入与预期行为，改动后跑一遍。

## 二、面试 Q&A 卡（8 张）

### 卡 1：为什么把一个 skill 拆成入口 + 多篇 docs，而不是写一个长文件？

**30 秒第一人称答案**：因为 skill 的读者是模型，上下文是硬成本。designcraft 正文约 2400 行，塞进入口等于每次对话先交一遍全文税。我把 `SKILL.md` 压到 97 行，只留适用范围、读法路由和模式表，正文按主题拆到 `docs/`，模型先读入口再按需加载。代价是路由写错会读不到正文，所以我用 `structure.test.mjs` 检查路由与 docs 可达性（`skills/designcraft/tests/structure.test.mjs`）。

**追问**：路由表怎么保证不过期？——靠测试：45 项必备文件 + 路由可达性断言。

### 卡 2：三个包为什么复制同一套发布脚本，而不是抽一个公共包？

**30 秒第一人称答案**：这是有意的重复。`AGENTS.md` 红线要求每个 skill 目录独立自包含，跨包依赖只允许用已发布 npm 版本（`AGENTS.md:9-15`）。抽公共 devDependency 会让单包 clone 跑不了 release-check。我接受三份 `check-package-content.mjs`（187/184/184 行）的维护成本，换「每个包都能独立发布」；包再多就把检查器做成已发布小包，而不是复制第四份。

**追问**：三份脚本怎么防止漂移？——靠人工同步；`release-content.test.mjs` 只测各自包，没有跨包一致性测试。

### 卡 3：Codecraft 只做文本级检查，为什么不用 AST？准确性怎么保证？

**30 秒第一人称答案**：因为目标是零依赖、低启动成本、可在任何项目里跑。用 TypeScript 编译器能提高 A2/A17 的准确率，但会把安装体积和启动时间拉上一个量级，也会限制只支持 JS/TS。我的补偿是：只机检高置信规则，`RULE_LIMITATIONS` 明确写出每条规则的盲区（`skills/codecraft/src/check.mjs:156-162`），输出 `coverage` 让用户知道扫了什么。准确性不靠「查得多」，靠「查到的都可解释、没查的明确说」。

**追问**：复杂 monorepo 误报怎么办？——用 `boundaries.allowedImporters` 登记例外，用 `--exclude` 排除生成目录；误报不能靠 ignore 硬压，要有理由。

### 卡 4：baseline 和 ignore 都能让问题消失，为什么保留两套？

**30 秒第一人称答案**：因为它们治理的是两种不同的东西。`ignore` 是逐条例外：某行代码确实要这么写，必须写 `rule/file/reason`，可设到期日，A21 密钥直接拒绝豁免（`skills/codecraft/src/ignore.mjs:25-29`）。`baseline` 是存量快照：老项目一次接入几千条问题，先全记下来，之后只许减少、不许增加（`skills/codecraft/src/cli.mjs:372-411`）。两套分开，例外有期限、存量只降不升，治理才可审计。

**追问**：baseline 会不会变成垃圾场？——`--update-baseline` 默认只减不增，新增条目要 `--force`；critical 永不入 baseline。

### 卡 5：designcraft 0.11 的 Refine 为什么要加「诊断闸门」和停止条件？

**30 秒第一人称答案**：因为设计评审最容易变成「我觉得不好看」然后直接改。0.11 把 Refine 拆成四段：证据与目标 → 诊断闸门 → 方案生成 → 交付校验（`skills/designcraft/scenarios/refine.md:37-80`）。诊断要求三证：现象、影响、可改（`:49-53`）；还有默认套路扫描五条，如等权卡片、图标+标题+副标题（`:55-63`）。停止条件是「证据不足就不进入方案生成」（`:65`）。报告边界也写死：只出 Markdown 方案集，不产出 HTML、不改文件（`:7-8`）。这是把评审从主观表达变成可复核流程。

**追问**：怎么防止套路扫描变成新的八股？——`docs/patterns.md` 明确是经验方案不是规则，新增条目只改它和 evals，不改判据、不新增档位（`skills/designcraft/CONTRIBUTING.md:16`）。

### 卡 6：你的扫描器性能如何？3,000 文件要 14 秒，怎么优化？

**30 秒第一人称答案**：实测 200 文件约 0.5–0.6 秒、1,000 文件约 3.4–3.7 秒、3,000 文件约 13–14 秒，近似线性，约 3.4–4.8 ms/文件（Windows、Node 24、合成仓库，见 05）。慢在每文件被完整读三次：`isMinified`、`scanAppFile`、`scanSecrets` 各一次（`skills/codecraft/src/check.mjs:183-202`、`:626-632`）。最值得做的优化是把 `isMinified` 并进首次读取，省约 1/3 的读与行切分。但典型仓库只有几百文件，收益最大的是用 `--changed` 缩小输入。

**追问**：为什么不做缓存？——CLI 是一次性进程，没有跨调用缓存；要做增量只能靠 `--changed` / `--since`。缓存有失效问题，作者选择简单。

### 卡 7：Windows 上测试失败说明什么？为什么 CI 没发现？

**30 秒第一人称答案**：说明路径处理有真实的可移植性缺陷。Windows 检出时 `path.relative` 返回 `src\config.ts`，测试断言的是 `src/config.ts`，于是 A17、A6、A21、`--exclude`、`--changed` 等 13–14 个用例失败。这不是测试太苛刻：JSON 和 SARIF 输出里的 `artifactLocation.uri` 会带反斜杠，下游工具可能解析失败。CI 只跑 `ubuntu-latest`（`.github/workflows/ci.yml:10-55`），所以从未暴露。修法是在 `path.relative` 结果上统一 `replace(/\\/g, '/')`，或者在测试断言前归一化；更好的做法是加一个 `windows-latest` job。

**追问**：哪些地方已经归一化了？——`ignore.matchPath`（`ignore.mjs:96-101`）和 `baseline.fingerprint`（`baseline.mjs:13-16`）已经统一 `/`；漏的是 `check` / `cli` 的报告路径。

### 卡 8：如果重做，你会改什么？

**30 秒第一人称答案**：三件事。第一，路径归一化做成公共函数，所有对外输出统一 `/`，并加 Windows CI，这是已暴露的真 bug。第二，把三份 `check-package-content.mjs` 收敛成一个已发布的 dev 工具包，减少同步，但保持每个包可独立发布。第三，合并 `check` 的三次文件读取或加增量缓存，让 3,000 文件从 14 秒降到个位数。定位不变：仍是「零依赖、文本级、可解释」。

**追问**：会不会加 AST？——除非目标用户变成大型 monorepo 且愿意承担依赖，否则不加；文本级 + 明确局限已经够用。

## 三、吹B一句话（能落地）

1. 「我们把 21 条代码宪法变成了 5 条可机检规则 + coverage 报告，0 findings 也能说清扫了什么。」
2. 「发布前不是看仓库，而是看 `npm pack --dry-run` 的真实清单——用户拿到什么，我们就扫什么。」
3. 「baseline 只减不增，ignore 必须写理由和到期日，密钥永远不能豁免——三种『不报』各有各的笼子。」
4. 「三个 npm 包、三套独立发布流水线，tag、版本、CHANGELOG 三方对齐，OIDC provenance 发布，没有长期 token。」

## 四、局限与不该抄的地方

- **单人维护、0 star**：2026-11-10 API 显示 0 stars、1 fork、1 contributor（UltimeLam，60 次贡献），created 2026-10-26。工程完整度高，但社区验证几乎为零，别把「有 CI」当「被验证过」。
- **不要抄「CI 只跑 Linux」**：至少加 Windows job，路径问题越早暴露越便宜。
- **不要抄「无 lint」**：982 行的 `cli.mjs` 靠人工风格约束，长期会漂移。
- **不要抄「文档即规则」的规模**：designcraft 15 篇 docs、约 2400 行，维护成本很高；没人手先从 3–5 篇开始。
- **待查实**：作者是否在真实大型仓库做过性能基准；仓库内无 benchmark 记录。
