# 09 · 运维：安装、配置、产物与回滚

> 结论先行：`@ultime/core` 是**离线构建工具**，没有服务进程、数据库、网络调用或遥测。运维面很小：装包、跑 CLI、管四份产物、按版本回滚。真正的风险不在运行时，而在「seed 泄漏商业设计」与「生成物被手改」两件事上。

## 安装

```bash
# Node >= 22.18
npm install -D @ultime/core
# 或
pnpm add -D @ultime/core
```

包同时提供库入口与 CLI：

```bash
npx ultime init          # 生成最小 ultime.config.json
npx ultime build         # 生成四份产物
npx ultime build --check # 只比对不写盘，CI 用
npx ultime schema        # 输出 Studio 可用的 schema
```

`bin/ultime.js` 只有 6 行，真正逻辑在 `dist/cli.js`；`init` 默认只把输出目录设为 `src/styles/tokens`，不覆盖已有配置（`src/cli/commands/init.ts:7-23`）。

## 配置

配置文件支持 JSONC（注释会被手写状态机剥离，`src/seed.ts:249-296`），CLI 默认读 `./ultime.config.json`。配置只有两层：顶层 `$schema`/`tokens`，所有选项都在 `tokens` 下：

```jsonc
{
  "$schema": "https://ultime.dev/schema/ultime.config.json",
  "tokens": {
    "seed": { "color": { "primaryHue": 222 }, "skeleton": { "radius": { "base": 4 } } },
    "output": "src/styles/tokens",
    "platforms": ["css", "json", "dtcg"],
    "subset": { "space": [4, 8, 12], "size": [32, 40], "radius": [4, 8], "fontSize": [14, 16], "lineHeight": [1.4], "letterSpacing": [0], "motionDuration": [100], "motionDelay": [50], "motionLoop": [1000] },
    "semantics": { "template": "default", "overrides": {} }
  }
}
```

仓库根还有一个 `tokens.config.json`，它只是九维 subset 的示例片段，不是完整 CLI 配置；不要把它直接喂给 `ultime build`。

校验规则在 `src/tools/config.ts:44-131`：未知字段报错、seed 可为对象或路径、subset 九维必须全给、platforms 不能为空、semantics 只接受 role.slot 覆盖。`seed` 写成文件路径时，路径相对配置文件解析（`src/cli/config-file.ts:14-44`）。

## 产物

一次构建生成四份文件（`scripts/build.ts:33-39`）：

| 文件 | 用途 | 是否可手改 |
|---|---|---|
| `tokens.css` | Web CSS 变量，含 light/dark 与 reduced-motion | 否 |
| `tokens.json` | 通用 JSON 快照 | 否 |
| `tokens.dtcg.json` | DTCG 标准格式，供下游工具消费 | 否 |
| `kernel.json` | 构建 manifest：seed、counts、合同、颜色报告、artifacts | 否 |

`kernel.json` 是排障入口：先看 `contracts.failed` 是否为 0，再看 `color.levels` 有没有 warn，最后核对 `seedHash` 是否与预期 seed 一致。它不含时间戳，所以不能用来判断「哪次构建」，只能判断「哪份输入」。

如果配置了 `semantics`，还会多一份 `semantics.json`，只写 token 路径与角色映射，不写值（`src/tools/semantics.ts:159-166`）。

## 升级

- **版本策略**：包版本、schemaVersion、engineVersion 三者独立（`rules/04-release.md:9-15`）；升级前先看 `kernel.json` 的 `schemaVersion` 是否变化。
- **升级步骤**：改 `package.json` 版本 → `pnpm install` → 跑 `pnpm build:tokens` → `pnpm check` → 对比新旧 `kernel.json` 的 counts/contracts → 提交产物。
- **破坏性变更**：0.x 阶段 API 可能变；根入口与四个子入口（`./seed`、`./exporters`、`./tools`、`./studio`）都是公共面，升级时优先看 exports 是否变动。
- **CI 固定版本**：生产项目建议锁死 `@ultime/core` 的精确版本，不要用 `^`，因为 0.x 的 minor 也可能破坏。

## 回滚

1. **包回滚**：`pnpm add -D @ultime/core@<old-version>`，再 `pnpm build:tokens` 重算；不要保留旧产物混用。
2. **产物回滚**：如果产物已提交，`git revert` 对应提交；不要手恢复单个 CSS 文件，否则与 seed 不一致。
3. **schema 回滚**：如果 `schemaVersion` 变了，旧产物可能无法被新代码读取；按 `rules/04-release.md` 的版本顺序回退三个包（cli → studio → core）。

## 安全

- **无网络**：构建不发起任何网络请求，`SECURITY.md` 明确说明这是离线构建器；供应链风险主要来自 npm 依赖，而 core 的运行时依赖只有同作者两个包。
- **seed 可能含商业信息**：品牌色相、比例、字体栈会写进 `kernel.json` 的 `seed` 字段；如果仓库公开，先确认这些参数能不能公开。不能公开就把 seed 放私有配置仓库，产物入库前删掉 `kernel.json` 或脱敏。
- **生成物完整性**：`build.ts --check` 是唯一可信的完整性检查；不要用「文件修改时间」判断产物是否最新。
- **权限**：CLI 只需要读写项目目录与输出目录，不需要 sudo、不需要全局安装；`npx` 临时执行即可。

## 监控与排障

没有运行时监控可做。构建期排障按这个顺序：

1. `pnpm build:tokens --check` 看是否有 drift；有则重跑生成。
2. 看 `kernel.json` 的 `contracts.failed`；非 0 时按 `contracts.ids` 定位。
3. 看 `color.report` 的 warn；颜色偏差不阻断，但可能是品牌验收问题。
4. 看 `seedHash`；与预期不符说明 seed 文件读错或合并逻辑变了。

## 结论

运维成本极低：装包、跑命令、管四份文件。真正需要制度化的是**版本锁定、产物同源、seed 保密**三件事；把这三件写进 CI 与发布清单，就算运维完成。
