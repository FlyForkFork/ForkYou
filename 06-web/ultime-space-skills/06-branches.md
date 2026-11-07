# 06 · 分支：只有 main，没有其他分支可对比

> 这篇回答什么问题：这个仓库有哪些分支？默认分支是什么？有没有实验分支、发布分支或未合并的工作？读代码应该从哪看？

## 结论

**只有 `main`，无其他分支可对比。** 本地 clone 的 `git branch -a` 只有：

```text
* main
  remotes/origin/HEAD -> origin/main
  remotes/origin/main
```

`work.json` 的 `branches` 字段也只有一条：`main`，SHA `a20cafa2075327e3d6456fcbe4a4fada1bf26073`，`default: true`，`ahead: 0`，`behind: 0`，`files: 192`，`changed_files: []`。没有 `dev`、`release`、`feature/*` 或长期实验分支。

## 分支数据

| 分支 | SHA | 用途 | 与 main 差异 |
|---|---|---|---|
| `main` | `a20cafa2075327e3d6456fcbe4a4fada1bf26073` | 唯一开发与发布分支 | 自身，无 diff |
| 其他 | 无 | 无 | 无 |

**不编造 diff**：因为没有其他分支，所以不存在 ahead/behind、变更文件数或关键 commit 对比。`work.json` 中 `diffstat` 为空字符串，`changed_files` 为空数组，这是事实而不是省略。

## 如果你习惯「按分支比较」

这个仓库不给你这种材料。正确的替代做法是：

1. 用 **tag 对比**代替分支对比：`git diff codecraft-v1.14.0 codecraft-v2.0.0 -- skills/codecraft`，看一个发布周期改了什么。
2. 用 **commit 对比**：`git log --oneline codecraft-v1.14.0..codecraft-v2.0.0`；注意本地是浅克隆，先 `git fetch --unshallow` 才能看到完整历史。
3. 用 **npm 包内容对比**：`npm pack @ultime/codecraft@1.14.0` 与 `@2.0.0` 解包后 diff，验证发布内容而不是源码分支。

## 分支保护与合并策略

仓库页面是否启用了 branch protection、是否要求 PR review、是否允许直接 push main，从本地 clone 无法判断，**待查实**。可以确认的是 `CONTRIBUTING.md` 要求从 `main` 切 `feat/` / `fix/` 分支、完成后 rebase 回 `main`（`skills/codecraft/CONTRIBUTING.md:7-12`）；这是流程约定，不等于平台侧的强制保护。

## 一个必须说明的采集限制

本地 clone 是**浅克隆**：`git rev-parse --is-shallow-repository` 返回 `true`，`git log` 只能看到一个可见 commit（`a20cafa`，2026-11-07，提交信息「docs: README 补 designcraft 安装与发布入口」）。因此本知识包对「历史提交、贡献者、代码演进」的判断能力有限；分支结论以 `git branch -a` 与 `work.json` 为准，历史细节标「待查实」。

## tag 不是分支，但能看出发布节奏

虽然只有一条分支，仓库有 27 个 tag，按包分三组：

- **Codecraft**：15 个，最早 `codecraft-v1.0.2`（2026-10-27），最新 `codecraft-v2.0.0`（2026-11-03），间隔 7 天。
- **Docscraft**：8 个，最新 `docscraft-v0.4.0`（2026-11-04）。
- **Designcraft**：4 个，最新 `designcraft-v0.9.1`（2026-11-07）。

这些 tag 对应 npm 发布节点，不是长期维护分支。`publish.yml` 的触发条件是 `push tags: codecraft-v*`，说明发布以 tag 为边界，而不是从某个 release 分支切出（`.github/workflows/publish.yml:3-7`）。27 个 tag 对应只有十几天可见历史，发布密度很高，说明三个包各自独立、小步快跑；tag 多不等于成熟，但至少证明发布链路被反复执行过。

## 读代码建议

1. **只读 `main`**。没有其他分支需要分流。
2. **按目录读，不按分支读**：先 `skills/codecraft/SKILL.md` → `src/cli.mjs` → `src/check.mjs`，再按需读 `gates/ignore/baseline`。
3. **用 tag 定位版本**：想复现某个 npm 版本，直接 `git checkout codecraft-v2.0.0`；不要假设 `main` 等于某个已发布版本。
4. **忽略 tag 之间的历史细节**：浅克隆看不到完整 ancestor 链，别从 `git log` 推断「某功能是哪次提交加的」。

## 分支风险

- **trunk-only 的 review 压力**：所有变更直接进 `main`，没有 release 分支做缓冲；质量靠 CI（三个 job）与 tag 前检查兜底。
- **没有长期实验分支**：新想法只能在本地分支或 fork 里做；`CONTRIBUTING.md` 约定从 `main` 切 `feat/<主题>` / `fix/<主题>`，完成后 rebase 回 `main`，主分支不保留中间提交（`skills/codecraft/CONTRIBUTING.md:7-12`）。这是工作流约定，不代表仓库里存在这些分支。
- **浅克隆导致审计盲区**：如果要做「某规则何时引入」的溯源，需要重新 `git fetch --unshallow`；当前知识包不提供这类结论。

> 一句话记住：**这是一条 `main` 走到底的仓库，分支对比为零；看发布节奏请看 tag，不要伪造分支 diff。**
