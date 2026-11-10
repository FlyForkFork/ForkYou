# 06 分支：只有两条，但一条不是代码

## 这篇回答什么问题

Oink 的分支结构非常简单，但它恰好展示了一个常见误区：**"ahead/behind 数字很大"不等于"改动很多"**。这篇说清两条分支各自是什么、怎么读、有什么风险。

## 分支列表

| 分支 | HEAD | 提交日期 | 性质 |
|---|---|---|---|
| `main` | `d8b29328678bfb50b5a9385a284f74572290c03b` | 2026-11-10 | 唯一代码主线，0.3.5 build 113 |
| `origin/update-feed-state` | `78c74faaf21ca2325168a23ff2e260d9589efecd` | 2026-11-09 | 更新 feed 的发布快照，**孤儿分支**（与 main 无共同祖先） |
| 本地 `update-feed-state` | `c120e81b3102805fe708871d206c7069fd814987` | 2026-11-06 | 同一 feed 分支的较早本地副本（比 origin 少 7 个提交） |

`git rev-list --left-right --count origin/update-feed-state...origin/main` 输出 **8 / 16**：feed 分支有 8 个 main 没有的提交，main 有 16 个 feed 分支没有的提交。这个数字看起来像"分支分叉很久"，实际上两边内容完全不同——一边是 35 个更新清单文件，一边是整个源码树。

## 用途

`update-feed-state` 不是开发分支，是**发布流水线的状态存储**。它只包含：

- `registry.json`、`pending-renewal.json`
- `records/*.json`（12 个，按内容哈希命名的签名记录）
- `site/index.html`、`site/heartbeat.json`、`site/CNAME`
- `site/mac/v1/mac-2026-01/{beta,stable}/appcast.xml` 与 `x64/` 下的同名文件（4 个）
- `site/windows/releases/{31,32,33,34,35,36,43,79,84,93,100,108}/release.json`（12 个）
- `site/windows/v1/win-2026-01/{beta,stable}/manifest.json`（2 个）

合计 **35 个文件**。这是 GitHub Pages 上更新站点的源，由 `.github/workflows/deploy-feed.yml`、`publish-macos-feed.yml`、`publish-windows-feed.yml`、`renew-windows-update-manifests.yml`、`seed-update-feeds.yml` 这些工作流读写。

## 变更规模

**不能看 diffstat。** `git diff --stat origin/main origin/update-feed-state` 会报 4055 个文件、831 insertions、693031 deletions——因为孤儿分支的树里没有源码，Git 认为"所有源码都被删了"。这不是真实的代码变更，是孤儿分支的假象。

真实规模是：**35 个文件，全部是 JSON/XML/HTML 发布产物**。8 个提交的标题全是 `Publish verified platform feed snapshot` 或 `Reserve Windows feed sequences`，没有一行产品代码。

## 关键提交

`origin/main..origin/update-feed-state` 的 8 个提交（从旧到新）：

- `c120e81` Publish verified platform feed snapshot（2026-11-06）
- `63e61c6` Reserve Windows feed sequences
- `26f7d3c` Publish verified platform feed snapshot
- `95e040f` Reserve Windows feed sequences
- `101190c` Publish verified platform feed snapshot
- `06e9ff1` Publish verified platform feed snapshot
- `1f25333` Reserve Windows feed sequences
- `78c74fa` Publish verified platform feed snapshot（2026-11-09）

"Reserve Windows feed sequences" 这个标题说明它做的是**序号预留**：Windows 更新清单要求单调递增的 build 号，先占位再发布，避免两个构建并发时撞号。

## 对 main 的影响

**零。** 两条分支没有共同祖先，`main` 的代码里不包含任何 feed 状态；feed 分支也不含任何源码。它们通过发布工作流间接关联：CI 打出的安装包 → 工作流写入 feed 分支 → GitHub Pages 提供 `appcast.xml` / `manifest.json` → 客户端更新器读取。

## 怎么读

- **读代码**：只看 `main`。
- **读发布流程**：看 `origin/update-feed-state` 的 35 个文件 + `.github/workflows/*feed*.yml`。
- **核对某个版本发布了没有**：看 `site/windows/releases/<build>/release.json` 或 `site/mac/v1/mac-2026-01/stable/appcast.xml`。

## 风险

1. **孤儿分支容易误判**：任何人用 `git diff main...update-feed-state` 都会得到"删了 4000 个文件"的结论。做仓库统计时要排除它。
2. **本地分支落后 origin 7 个提交**：本地 `update-feed-state` 是 11-06 的快照，`origin` 是 11-09。如果有人基于本地分支继续发布，会回滚掉三天的 feed。**读之前先 `git fetch`**。
3. **feed 分支的历史会被重写**：`Reserve` 类提交暗示序号可能被回退/重用（"reserve" 是预留，如果构建失败可能要回收）。这类分支不适合当审计日志。
4. **发布产物与源码版本可能短暂不一致**：feed 分支的 `78c74fa` 是 11-09，而 `main` 的 0.3.5 是 11-10 发布——发布流程本身有延迟窗口。

## 一句话记住

Oink 只有一条代码主线：`update-feed-state` 是发布站点的孤儿快照，**它的 ahead/behind 和 diffstat 全是假象，只有 35 个 JSON/XML 文件是真的**。
