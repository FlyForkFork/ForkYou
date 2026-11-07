# 06 · 分支：只有 main，没有可对比的 diff

> 结论先行：**这个仓库只有 `main` 一个分支，没有其他分支可对比。** 本地 clone 的 `git branch -a` 只有 `main` 与 `remotes/origin/main`，没有 feature/release/hotfix 分支；work.json 的 `branches` 数组也只记录了一条 main（sha `a0dd5dd`，ahead 0 / behind 0，diffstat 为空，changed_files 为空）。任何「分支差异」「未合并工作」在本项目都不存在，不要编造。

## 事实

- 默认分支：`main`。
- 分析基线：`a0dd5ddfe2eab3298e76b90d6ef9aae216f8b26a`（短 sha `a0dd5dd`，tag `v0.5.1`）。
- 分支数：1（本地与远端一致）。
- 远端：`origin` 指向 `FlyForkFork/ultime-space-core`，`origin/HEAD -> origin/main`。
- 浅克隆可见历史：`a0dd5dd chore(release): 0.5.1`，以及被 graft 截断的 `v0.5.0`、`v0.4.2`、`v0.4.1` 标签。工作树干净，没有未提交改动。

## 为什么只有一个分支

从 `rules/04-release.md` 的发布流程可以反推：作者把「版本」当成 tag + 三个版本号（包版本、schemaVersion、engineVersion）来管理，而不是靠长期分支（`rules/04-release.md:9-15`）。发布顺序是 `@ultime/cli → @ultime/studio → @ultime/core`（`rules/04-release.md:21-23`），publish 工作流由 `v*` tag 或手动触发（`.github/workflows/publish.yml`），也不依赖 release 分支。

这是一个**单人/早期项目**的合理选择：没有并行团队，就没有长期分支的协调成本；所有开发直接进 main，用 tag 标记可发布点。代价是没有「下个版本」的隔离区，破坏性改动只能靠版本号与 changelog 说明。

## 用 tag 代替分支的发布模型

这个仓库虽然只有一个分支，却有多个版本 tag：`v0.4.1`、`v0.4.2`、`v0.5.0`、`v0.5.1` 都能在本地 `git log --all` 里看到（浅克隆被 graft 截断，但 tag 仍指向对应提交）。这说明作者的发布模型是「main 上持续开发，打 tag 即发布」，而不是「release 分支冻结、main 开发下一版」。

这种模型适合单人项目：没有并行维护多个版本的需求，也没有 cherry-pick 的协调成本；缺点是无法同时维护 0.4 与 0.5 两条线，安全修复只能发新版本。`publish.yml` 用 tag 触发发布并要求 tag 与 `package.json` 的 version 一致（`.github/workflows/publish.yml`），进一步把「tag 是唯一发布凭据」固定下来。

如果你要基于这个仓库做二次开发，建议自己开一个 fork 分支（例如 `vendor/our-theme`），而不是直接改 main；否则上游更新时无法区分「我们的定制」与「上游变更」。这是使用单分支上游的通用做法，不是项目本身的缺陷。

## 对读者的含义

1. **不存在「main 与 dev 的差异」可分析**：如果你看到别的分析写了分支 diff，那是错的。
2. **看历史只能看 tag**：`v0.5.1` 是当前基线，`v0.5.0` 引入了光影五槽/方向边线/solveLight（从 tag 提交信息可见），再往前是发布配置修正。
3. **贡献者应从 main 开短分支**：`CONTRIBUTING.md` 要求 `feat/` 或 `fix/` 分支、rebase 到 main、一个提交一个主题（`CONTRIBUTING.md`），但这些是贡献流程约定，不是仓库现有的长期分支。
4. **回滚以 tag 为单位**：没有 release 分支可切，回滚就是 `git checkout v0.5.0` 或安装对应 npm 版本。

## 对 ForkYou 分析的影响

- 06 篇无法做「分支对比」章节，只能记录单分支事实；这是任务书明确要求写清的。
- 02/03 的架构分析以 `a0dd5dd` 为准；tag 之间的发布差异不影响当前基线结论，所以不展开逐版本 diff。
- 08 篇的「可迁移想法」不依赖分支历史，只依赖当前代码。

## 结论

**只有 main，无其他分支可对比。** 这是一个用 tag 而非分支管理发布的早期仓库；读者应把 `v0.5.1` 当成唯一可信基线，不要期待 dev/next/release 分支的存在。该结论来自 work.json 的 branches 数组与本地 `git branch -a` 双重核对，不是从 README 推断。
