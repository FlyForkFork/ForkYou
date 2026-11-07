# 09 · Ops：安装、配置、升级与供应链

> 这篇回答什么问题：把 ultime-space/skills 用到真实项目里，怎么装、怎么配、怎么排错、怎么升级/回滚、供应链上要注意什么？

## 安装方式

| 方式 | 命令 | 适用 |
|---|---|---|
| A · skills CLI | `npx skills add ultime-space/skills --skill codecraft`（或 `--skill='*'`、`-g`、`-a <agent>`） | 个人/单项目，交互选择 agent；要求 Node >= 22.20 |
| B · npm + skills-npm | `npm i -D @ultime/codecraft @ultime/docscraft @ultime/designcraft skills-npm`，再 `npx skills-npm setup` | 团队/多项目，跟随 `npm install` 同步到 agent 目录 |
| C · 手动指针 | 在 `AGENTS.md` 写「代码任务先读 <路径>/skills/codecraft/SKILL.md」 | 不想复制文件，或 agent 不支持 skills CLI |

npm 包：`@ultime/codecraft@2.0.0`、`@ultime/docscraft@0.4.0`、`@ultime/designcraft@0.9.1`（2026-11-08 查询）。Codecraft 含 `codecraft` 命令；Docscraft / Designcraft 只有内容与测试，没有可执行文件。

## 配置

Codecraft 在项目根放 `codecraft.config.json`（示例 `skills/codecraft/codecraft.config.example.json`）：

```json
{
  "pack": "auto",
  "exclude": ["dist/**", "coverage/**"],
  "baseline": "codecraft-baseline.json",
  "gates": [
    { "id": "typecheck", "entry": "pnpm typecheck", "timeoutMs": 120000 }
  ],
  "ignore": [
    { "rule": "A17", "file": "src/pages/legacy/**", "reason": "legacy; migrate 2026-Q4", "expires": "2026-12-31" }
  ],
  "boundaries": { "external": ["@/types/external"], "generated": ["@/types/project"] }
}
```

- `pack`：`app` / `library` / `design-system` / `auto`；CLI `--pack` 优先。
- `gates` 2.0 契约：`id` + `entry` 必填；`args/files/exclude/output/threshold/timeoutMs` 可选；1.x 的 `run`/`name` 会报迁移错误。
- `ignore`：A21 不可豁免；`expires` 过期不生效。
- 没有端口、没有数据目录、没有日志文件：CLI 输出到 stdout/stderr，报告即诊断包。

## 安装后验证

```bash
npx @ultime/codecraft version        # 应输出版本号
npx @ultime/codecraft check --root . # 报告模式，退出码 0 不代表没问题
```

如果 agent 读不到 skill，先确认安装目录里存在 `SKILL.md`，再确认 agent 的技能目录配置；`skills` CLI 的安装路径由它自己维护，本仓库不枚举。用 npm 方式时，检查 `node_modules/@ultime/codecraft/SKILL.md` 是否随包发布。

资源占用很轻：包本身只有文本与少量 JS，没有二进制、没有数据库、没有后台进程；CI 与本地运行的主要成本是 Node 启动和文件遍历，不是内存。

## 资源需求

- **CPU/内存**：单进程 Node，扫描普通项目为秒级；内存主要是 findings 与文件内容，没有索引。
- **磁盘**：安装包本身（Codecraft 2.0.0 约 372KB 解包，Docscraft 约 70KB，Designcraft 约 178KB）。
- **网络**：CLI 不联网；安装/发布才访问 npm。
- **系统**：Node >= 20；`--changed/--since` 需要 git；gates 需要对应命令可用。

## 可观测性

- Markdown 报告：`Rules`、`Coverage`、`Critical`、`Findings`、`Ignored`、`Expired Exceptions`、`Gates`。
- JSON：字段稳定契约（2.0.0 起只增不改语义），含 `coverage`、`baseline`、`compare`、`summary`、`gates`。
- SARIF：可直接上传 GitHub Code Scanning。
- 没有 metrics / tracing / 日志文件；CI 里把 `--format json` 存档即可做趋势。

## 故障模式与排查

| 现象 | 原因 | 处理 |
|---|---|---|
| exit 2，root not found | `--root` 路径错或不在项目目录 | 传绝对路径或 `cd` 到项目 |
| exit 2，invalid config | gate 仍用 1.x `run`/`name`，或 threshold 没配 output | 按错误提示改 `entry`/`id`；先声明 `output` |
| exit 2，0 source files | `--pack` 判错或目录没有 JS/TS | 显式 `--pack app|library`，或检查 `--root` |
| exit 2，`--rules` 全不在 pack | 规则 ID 不属于当前 pack | 换 `--pack` 或去掉 `--rules` |
| 基线没抑制 | 基线文件不存在（只告警）或格式版本不符（直接报错） | `check --update-baseline` 重建；不要手改 format |
| gate 失败 | 退出码非 0，或 threshold 条件为真 | 看 gate 输出（已脱敏）；先修业务命令 |
| tag 发布失败 | tag 与 `package.json.version` 不一致，或版本已存在 | `node -e` 对齐版本；bump 后重打 tag |

## 安全注意事项

- **CLI 不读不上传代码**（`skills/codecraft/README.md:470`）；所有扫描本地完成。
- **gates 是任意 shell 命令**：只能来自可信配置；fork PR 不要跑 `audit --run-gates`；gate 继承完整环境变量，输出会脱敏但不是沙箱（`skills/codecraft/docs/shared/04-gates.md:1-108`）。
- **密钥红线**：A21 命中标 `critical`、置顶、不可 ignore、不可入 baseline；发现即移除并轮换。
- **供应链**：npm 包带 SLSA provenance，发布由 GitHub Actions Trusted Publishing（OIDC）完成，仓库不存 token；安装时锁定版本、保留 lockfile，定期 `npm audit`。

## 升级与回滚

- **升级**：按 semver；Codecraft 1.x → 2.0 是破坏性变更：gate 的 `run`→`entry`、`name`→`id`，`audit` 默认不跑 gates，必须显式 `--run-gates`（`skills/codecraft/README.md:317-360` 的升级段落）。
- **回滚**：npm 方式直接固定旧版 `npm i -D @ultime/codecraft@1.14.0`；tag 方式 `git checkout codecraft-v1.14.0` 后重新安装。skills CLI 方式默认跟随仓库分支，精确回滚建议改用 npm（推断：skills CLI 的 tag/ref 安装能力待查实）。
- **版本查询**：`npm view @ultime/codecraft versions --json`；tag 列表 `git tag -l 'codecraft-v*' | sort -V`。
- **发布前自检**：`npm test && npm run release-check && npm pack --dry-run`；Codecraft 再加 `npm run eval && npm run self-check`。

> 一句话记住：**安装三条路、配置一个 JSON、运行无服务无端口；升级看 semver 与 tag，回滚锁 npm 版本，安全底线是 A21 不可豁免 + OIDC 发布 + provenance。**
