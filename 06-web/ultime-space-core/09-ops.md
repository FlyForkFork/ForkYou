# 09 · 运维：一个离线构建工具怎么上线、排障、升级

**这篇回答什么问题**：把 `@ultime/core` 放进项目后，怎么装、怎么配、出问题看哪里、升级会不会炸。

## 安装/部署方式

`@ultime/core` 是构建期库和 CLI，不是服务；没有守护进程、端口、数据库或定时任务。

```bash
pnpm add @ultime/core
# 或已在 devDependencies 中：
pnpm install --frozen-lockfile
```

要求 Node.js `>=22.18`（`package.json:70-72`）。安装后：

- 程序化调用：`import { buildCore } from '@ultime/core'`，或 `import { planProject } from '@ultime/core/tools'`；
- CLI：`pnpm exec ultime <command>`（bin 名 `ultime`，`package.json:10-12`）；
- 配置器：`import { themeStudio } from '@ultime/core/studio'`（会引入 `@ultime/studio` 依赖）。

部署到 CI 时只需把 `pnpm build:tokens --check` 放进流水线；产物可以入库，也可以作为构建产物上传。

## 配置项、目录与日志

`ultime init` 会写一份 `ultime.config.json`（JSONC）。可用字段只有：

```jsonc
{
  "tokens": {
    "seed": {},                    // 对象，或指向 seed 文件的相对路径字符串
    "platforms": ["css", "json", "dtcg"],
    "output": "ultime-tokens",     // 产物目录
    "semantics": {                 // 可选：语义表
      "template": {},
      "overrides": {}
    }
  }
}
```

`validateConfig` 只认 `tokens.seed / platforms / output / semantics`，未知字段直接报错（`src/tools/config.ts`）。`platforms` 为空、`output` 为空都会被配置器判 error（`src/studio/index.ts:133-147`）。

- **数据目录**：默认 `ultime-tokens/`，输出 `tokens.css` / `tokens.json` / `tokens.dtcg.json` / `kernel.json`；选择导出不含 `kernel.json`。
- **日志**：没有日志文件；CLI 把摘要和诊断打到 stdout/stderr（`scripts/build.ts:50-80`）。`ultime inspect --json` 输出机器可读的产物、平台、模式、计数、合同、颜色、诊断（`src/cli/commands/inspect.ts:54-69`）。

## 资源需求

- 无网络、无外部服务；Node 进程一次构建。
- 本机实测 `buildCore` 约 90ms、四份产物合计约 319KB（见 05）；CPU/内存没有官方基准，待查实。
- 磁盘占用主要是产物 + 依赖；DTCG 文件最大（默认 186KB）。

## 日常操作手册

**首次接入**：`ultime init` 生成 `ultime.config.json` → 改 `tokens.seed` 指向品牌 seed（或直接内联对象）→ `ultime build` → 把 `ultime-tokens/` 加进 `.gitignore` 或按需入库。仓库自己的选择是入库，因为产物要参与 diff 与 `--check`。

**日常改主题**：改 seed → `pnpm build:tokens` → 看 CLI 摘要的 `seedHash` 与合同失败数 → `git diff` 只应出现预期文件 → 提交源与产物。不要把生成物当源码改，也不要把产物排除在 diff 之外。

**接入 CI**：两步足够——`pnpm install --frozen-lockfile` 后跑 `pnpm check`；`check` 里的 `build --check` 会在“源码新、产物旧”时退出 1。如果项目不在 pnpm workspace 里，也可以直接跑 `npx ultime build --check`。

**发布前**：对比上一版 `kernel.json` 的 `schemaVersion` / `engineVersion` / `counts` / `contracts.ids`；如果 `counts` 变了，确认是预期新增；如果 `contracts.total` 变了，确认合同代码与模型同批改过。

**多品牌/多项目**：一个 seed 一份配置、一个输出目录；不要试图用一份 `tokens.css` 覆盖多个品牌。若要复用构建，用 `planProject` 在 Node 里循环多个 seed，而不是在 CLI 里传多个配置——CLI 一次只处理一个 `tokens` 区。

## 资源与容量规划

- **CPU**：单次构建单核；没有并行/worker。CI 里把它当普通 Node 脚本即可。
- **内存**：树 + 三份字符串，默认规模在几十 MB 内；DTCG 186KB、CSS 59KB，真正的内存峰值来自 `JSON.stringify` 的中间字符串（推断，未做 heap profile）。
- **磁盘**：默认四份产物约 319KB；如果每天构建并提交，git 仓库会随历史增长，建议对 `tokens.dtcg.json` 这类大文件接受 diff 噪声，或用 `--check` + 构建产物上传替代入库。

## 可观测性

看四个地方：

1. **`kernel.json`**：`schemaVersion` / `engineVersion` / `seedHash` / `counts` / `contracts` / `color.levels`。同 seed 的 `seedHash` 应稳定。
2. **CLI 摘要**：token 总数、分类计数、合同总数/失败数/覆盖类数、产物个数（`scripts/build.ts:51-66`）。
3. **诊断**：`planProject.diagnostics` 的 `level/code/message/path`；合同失败 code 是 `contract.<id>`，`blocking` 为 error，颜色为 warn（`src/tools/project.ts:53-62`）。
4. **颜色报告**：`manifest.color.levels` 的 pass/warn/deviation 计数；默认 seed 是 `pass: 106`，非 pass 才需要看 `report` 明细。

## 故障模式与排查

| 现象 | 可能原因 | 排查 |
| --- | --- | --- |
| `配置：未知字段 ...` | `ultime.config.json` 拼错字段 | 只保留 `tokens.seed/platforms/output/semantics` |
| `tokens.seed 是文件路径：请先读取成对象` | 直接把字符串传给 `planProject` | 先 `readJsonc` / `readSeedFile`，CLI 已处理 |
| `build --check` 报“产物与源不一致” | 改了 seed/模型没重跑 `build:tokens`，或手改了生成物 | 跑 `pnpm build:tokens` 后提交四份产物 |
| `contracts.failed > 0` | 结构合同失败（几何/动效/光影/树结构） | 看 `kernel.json.contracts.ids` 和诊断里的 `actual/target` |
| `color.levels.warn > 0` | 颜色目标不可达或偏离 | 看 `manifest.color.report` 的 `pair/reason`；可调 `contrastAllow`，但别滥用 |
| `semantics.invalid` | 语义表引用了不存在的路径或环 | `validateSemantics` 检查路径、`@role.slot` 引用与环（`src/tools/semantics.ts`） |
| `ERR_PNPM_BROKEN_LOCKFILE` | pnpm 版本低于 `pnpm@12` | 用 `corepack`/pnpm 12.6.0，不要用 pnpm 9 读 lockfile |
| `tokens.json.schemaVersion` 还是 4.0.0 | 已知遗留，`src/exporters/json.ts:32` 硬编码 | 升级判断以 `kernel.json` 的 `6.0.0` 为准，或提交修复 |

## 升级检查清单

从 0.5.x 升到 0.7.x（或未来 0.8）时，按这份清单走：

1. **读 CHANGELOG 的 Breaking 段**：0.5.0 改光影命名、0.6 删 `tokens.subset`、0.7 新增 studio 选择 API；0.8 又会收紧出口。0.x 的 minor 不等于兼容。
2. **对比两份 kernel**：旧产物的 `schemaVersion/engineVersion/counts/contracts.ids/color.levels` 与新构建逐项比；`engineVersion` 变是算法变，`counts` 变是树变，两者都要有解释。
3. **跑 `pnpm check`**：格式/守卫/产物同源三段；如果 `--check` 失败但源码没改，通常是新版本改变了序列化格式，按新版重跑 `build:tokens`。
4. **看依赖**：`@ultime/cli` / `@ultime/studio` 的版本要与 core 匹配；core 的 `package.json` 已写 `^0.1.0`，跨大版本要一起升。
5. **回滚演练**：把包 pin 回旧版，用旧版重跑构建，确认旧产物能覆盖新产物；不要用新版生成的产物配旧版引擎。

## 安全注意事项

- 内核离线运行，不发起网络请求（`SECURITY.md:11-14`）；主要风险是 **seed / theme 里写入凭据或内部信息**，以及产物被手改后与源不一致。
- 生成物可能被提交到公开仓库：seed 中的品牌色、内部命名、注释都可能泄露；提交前检查 `tokens.json` 的 `seed` 字段（它包含完整 seed）。
- 依赖供应链：`@ultime/cli` / `@ultime/studio` 是仅有的第三方运行时依赖；发布走 npm Trusted Publishing + provenance（`.github/workflows/publish.yml:9-11`、`:58-62`）。
- 不要把 `selection` / `derivation` 当成安全边界：它们只过滤/重算已构建的树，不执行用户代码（`src/studio/derivation.ts:1-6`）。

## 升级与回滚

- **版本语义**：`schemaVersion` 管树与合同字段的兼容面，`engineVersion` 管派生实现（`README.md:282-288`）。0.7.0 只升 `engineVersion`，树/合同不变；0.5.0 是契约刷新（`rim` → `highlight.ambient` 等）。
- **升级前**：对比新旧 `kernel.json` 的 `schemaVersion / engineVersion / counts / contracts`；如果 `schemaVersion` 变，先读 `CHANGELOG.md`，0.x 不提供迁移器。
- **回滚**：把包版本 pin 回旧版，用**旧版重新生成**产物；不要用新版产物配旧版引擎。产物与 seed 同批回滚。
- **CI 建议**：`pnpm check`（含 `build --check`）作为合并门禁；发布 tag 必须是 `v` + `package.json.version`，否则 publish workflow 直接失败（`.github/workflows/publish.yml:31-37`）。

**一句话记住**：它没有“线上运维”，只有“构建产物治理”：看住 `kernel.json` 的版本/计数/seedHash，盯住 `contracts.failed` 和 `color.levels`，升级时先比 manifest 再换包。
