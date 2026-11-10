# 04 深挖 · Skill 打包：把「知识」做成可安装、可验证、可发布的 npm 包

> 这篇回答什么问题：一个以 Markdown 为主的 skill，怎么保证用户 `npm i` 之后拿到的东西**和仓库里一致、没有内部残留、版本可追溯**？`@ultime/*` 三个包给出了一套很轻但完整的发布工程。

## 问题是什么

Agent skill 的本质是「一堆给模型读的文档 + 少量脚本」。它天然容易烂在三处：

1. **入口与正文混在一起**：SKILL.md 越写越长，模型每次都要全读，上下文成本高；改一条规则要动入口文件，路由和正文互相污染。
2. **包内外不分**：仓库里有内部路线图、内部包名、本地绝对路径；`npm pack` 的 `files` 只回答「打哪些文件」，不回答「这些文件里有没有不该给外人看的东西」。
3. **版本靠自觉**：`VERSION`、`package.json`、`CHANGELOG`、git tag 四处各写一遍，发版时总有一处对不上。

三个包的解法是：**入口只做路由，正文全部在 docs/；发布前对真实 pack 清单做内容扫描；版本、变更日志、tag 三处交叉校验；发布走 OIDC provenance。**

## 朴素做法为什么不够

- **只写 SKILL.md**：单文件 skill 在 100 行内可行；designcraft 的 docs 已 15 篇、约 2400 行，塞进入口等于每次对话都交一遍全文税。
- **只靠 `.npmignore` / `files`**：能挡住 `tests/`，挡不住文档正文里的一句 `@ultime/core` 或 `/Users/xxx`。
- **手写「发布检查清单」**：人会忘。三份 `release-check.mjs` 把清单变成退出码。
- **在 CI 里 `npm publish` 用长期 token**：泄露即供应链风险；这里用 `id-token: write` + `--provenance`，由 GitHub Actions 的 OIDC 身份签名。

## 核心机制

### 1. 目录契约：入口、正文、场景、模板、评测各就各位

每个包的结构一致：`SKILL.md`（入口/路由）、`docs/`（规则正文）、`scenarios/`（场景剧本）、`prompts/`（提示模板）、`templates/`（可复制骨架）、`evals/`（评测用例）、`VERSION` + `CHANGELOG.md`。

codecraft 的 SKILL.md 末尾只留一句：「规则正文只在 `docs/`；本文件只做入口。」（`skills/codecraft/SKILL.md:102`）。这是**文档规定**；代码层由 `structure.test.mjs` 检查必备文件与禁词，防止正文回流到入口。

### 2. 发布前四道闸门

`release-check.mjs` 是发布前的总闸，做四类检查（`skills/codecraft/scripts/release-check.mjs:20-54`）：

1. **版本一致性**：`VERSION` 必须是 `x.y.z`；`package.json.version` 必须等于 `VERSION`；`CHANGELOG.md` 必须有当前版本的 `## x.y.z` 段。
2. **变更日志卫生**：版本段不能重复；不能出现比当前版本更高的「未来版本」（`:30-34`）。
3. **结构完整性**：codecraft 要求 `SKILL.md` / `VERSION` / `CHANGELOG.md` 与 `docs` / `scenarios` / `prompts` / `templates` 都存在，且都在 `package.json.files[]` 里（`:36-48`）。designcraft 与 docscraft 的要求更严：再加 `README.md` / `LICENSE` / `CONTRIBUTING.md` / `SECURITY.md` 与 `evals/`（`skills/designcraft/scripts/release-check.mjs:36-46`）。
4. **发布内容扫描**：调用同目录的 `check-package-content.mjs`（`:50-54`）。

第 3 条里「必须在 files[] 里」是关键：文件存在但没被打包，等于用户拿不到；`files` 写了但目录不存在，`npm pack` 会静默忽略。检查把两者钉在一起。

### 3. 内容检查：扫「真实打包清单」，不是扫仓库

`check-package-content.mjs` 的第一行注释就把动机写清楚了：「npm 的 files 字段只保证『打包哪些文件』，不保证这些文件里没有内部路径、内部包名或本地绝对路径」（`skills/codecraft/scripts/check-package-content.mjs:5-7`）。

实现分三层：

- **文件层**：`FORBIDDEN_FILES` 六类正则——`tests/`、`node_modules/`、`.git/`、编辑器目录、缓存/日志、密钥文件（`:40-47`）。
- **内容层**：`CONTENT_RULES` 三条——本地绝对路径（`/Users/`、`/home/`、`C:\`、`file://`）、内部仓库路径（`docs/roadmap`、`docs/design-system`、`packages/(core|kit|viewer|studio|cli)`）、内部包名（`@ultime/(core|kit|viewer|studio|cli)`）（`:50-66`）。
- **路径层**：`realpathSync` 后检查是否越出包根，防止 symlink 把外部文件带进发布物（`:142-160`）。

扫描对象来自 `npm pack --dry-run --json --ignore-scripts` 的实际文件清单（`:77-95`），不是 `fs.readdir` 的仓库目录——这样 npm 的 `files` 语义、`.npmignore`、默认忽略规则都被如实反映。文本文件上限 1MB，超过则报 `[unscanned]` 而不是静默跳过（`:97-103`、`:164-169`）。

例外必须登记在 `ALLOW` 表里并写理由，例如 codecraft 的 `evals/fixtures/a21-placeholders/.env` 是 A21 的占位夹具，只含空值与变量引用（`:69-75`）。注释里明确「不要用注释绕过」（`:13`）。

### 4. 三份脚本、三份复制：自包含的代价

三个包各自带一份 `check-package-content.mjs`（187 / 184 / 184 行）和一份 `release-check.mjs`。这是**有意重复**：AGENTS.md 红线要求「每个 skill 目录独立自包含，不把其他 skill 或根仓材料复制进来」，而跨包依赖只允许用已发布的 npm 版本（`AGENTS.md:9-15`）。

代价是修一个检查规则要改三处；收益是任意一个包单独 clone、单独发布都能跑通，不依赖 monorepo 根目录。

### 5. 发布链路：tag 触发、版本查重、provenance

`.github/workflows/publish.yml`：tag `codecraft-v*` 或手动触发；权限只有 `contents: read` 与 `id-token: write`；步骤依次是 checkout → setup-node → 全局装 `npm@11` → 用 `node -e` 校验 tag 与 `package.json.version` 一致 → `npm view` 确认该版本尚未发布 → `npm test` → `npm run eval` → `npm publish --access public --provenance`（`.github/workflows/publish.yml:1-51`）。docscraft / designcraft 各有一份同构 workflow。

两个细节值得学：

- **tag 与版本比对在 CI 里做**，不靠人记；tag 打错会直接失败，不会发出一个「版本号与 tag 不符」的包。
- **`npm view` 查重**：npm 不允许覆盖已发布版本，先查一次能把「重复发布」变成清晰报错，而不是发布中途失败。

### 6. evals 也是包的一部分

codecraft 的 `evals/cases.json` 有 19 个 case，`evals/run.mjs` 用 `spawnSync` 跑真实 CLI（`skills/codecraft/evals/run.mjs:1-87`）。评测不是单测的替代，而是「模型拿到 skill 后能否按预期完成任务」的回归；发布 workflow 里 `npm test` 之后必跑 `npm run eval`，说明作者把「文档改坏导致 agent 行为退化」当成发布阻断项。

## 代码证据（7 处）

1. `skills/codecraft/scripts/release-check.mjs:24-34`：版本、CHANGELOG 段、重复段、未来版本四项校验。
2. `skills/codecraft/scripts/release-check.mjs:36-48`：必备文件/目录必须同时存在且在 `files[]`。
3. `skills/codecraft/scripts/check-package-content.mjs:40-66`：六类禁入文件 + 三类内容规则。
4. `skills/codecraft/scripts/check-package-content.mjs:77-95`：以 `npm pack --dry-run --json` 的真实清单为扫描输入。
5. `skills/codecraft/scripts/check-package-content.mjs:142-169`：symlink 越界、1MB 上限、逐文件扫描。
6. `skills/designcraft/scripts/release-check.mjs:36-46`：知识型包额外要求 README/LICENSE/CONTRIBUTING/SECURITY 与 evals。
7. `.github/workflows/publish.yml:1-51`：tag 触发、OIDC 权限、版本查重、test+eval、`--provenance`。

## 复杂度与边界

- **检查成本**：`npm pack --dry-run` 本身要遍历一次文件；随后对每个文本文件读一次并逐行跑三条正则。整体 O(文件数 × 行数)，对 200 文件级别的包是秒级。
- **误报面**：绝对路径正则会把示例里的 `C:\` 也报出来，所以示例要么用相对路径，要么登记 ALLOW；内部包名规则只覆盖 `@ultime/*` 五个包，新增内部包要同步正则。
- **覆盖盲区**：非文本扩展名（图片、二进制）不扫内容；>1MB 文本只报 unscanned 不阻断（findings 里算一条，会让 release-check 失败，实际是阻断的）。
- **单点依赖**：`npm pack` 的 JSON 输出格式变化会影响 `packFiles`；脚本用 `raw.indexOf('[')` 容错前缀日志（`:90-92`），但 npm 大版本升级仍需回归。

## 取舍与局限

1. **自包含 > 复用**：三份重复脚本换来独立发布能力；如果包数量再增长，应考虑把检查器做成已发布的 devDependency，而不是复制第四份。
2. **发版检查在本地/CI 双跑**：`prepublishOnly` 与 workflow 都跑 test/eval，重复但能防「本地忘跑」；代价是发布耗时增加。
3. **`files` 白名单是人工维护**：新增目录必须同时改 `package.json` 与 `release-check` 的 requiredDirs，否则检查会失败——这是有意的「双写」，用失败提醒而不是自动同步。
4. **版本以 `VERSION` 为真源**：`package.json` 是派生副本，靠 release-check 对齐；比「以 package.json 为唯一真源」多一个文件，但让非 JS 工具也能读版本。
5. **evals 覆盖有限**：19 个 case 只能覆盖典型任务，不能证明「任意提示下都正确」；它是回归网，不是正确性证明。

## 我能偷什么

- **入口只做路由**：SKILL.md 控制在 100 行内，正文按主题分文件；模型按需加载，改规则不碰入口。
- **发布前扫真实 pack 清单**：不要扫仓库，扫 `npm pack --dry-run --json` 的结果，才能反映用户实际拿到什么。
- **结构检查里绑定 `files[]`**：文件存在 ≠ 会被发布；把「存在」和「在 files 里」写成同一条断言。
- **例外表 + 理由**：任何 allowlist 都要求写「为什么」，并且代码注释明确禁止用注释绕过。
- **tag/version/CHANGELOG 三方对齐**：发布流水线的第一件事就是校验三者一致，失败要早、要清楚。
- **OIDC + provenance**：不再保存 npm token；发布身份由 CI 提供，包上带可验证的来源证明。

> 一句话记住：**skill 打包的核心不是「打进去」，而是「证明打进去的每一个字节都可以给外人看」——入口/正文分离、真实清单扫描、版本三方对齐、provenance 发布，四件事做完，知识才变成产品。**
