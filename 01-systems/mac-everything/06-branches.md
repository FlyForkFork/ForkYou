# 06 分支：差异、风险、该读哪个

> 这篇回答：分支之间到底差什么。

## 分支列表

数据来自 `git -C D:\FlyForkFork\mac-everything rev-list --left-right --count origin/main...origin/<branch>` 与 `git diff --shortstat origin/main..origin/<branch>`（2026-11-07）。

| 分支 | 用途 | HEAD | 文件数/行数 | 与 main 关系 |
|---|---|---|---:|---|
| `main` | 默认分支 | `70bbad5` | — | 基准 |
| `ci/release-dmg` | DMG 打包 CI | `b4165d5` | 46 files，+815/−2164 | 0 ahead / 11 behind（已合并） |
| `claude/release-workflow` | 签名、公证、GitHub Release | `fd3789a` | 77 files，+1772/−3221（对 main 两点 diff） | **2 ahead / 18 behind（唯一未合并）** |
| `codex/sync-about-changelog` | About/变更记录同步 | `7ee6c3b` | 0 files | 0 ahead / 3 behind（已合并） |
| `fix/index-rewrite-amplification` | 降低索引重写写放大 | `93c5bbb` | 52 files，+821/−2395 | 0 ahead / 15 behind（已合并） |
| `fix/root-rescan-duplicates` | 根目录重扫去重 | `7f9c5bf` | 49 files，+815/−2355 | 0 ahead / 13 behind（已合并） |
| `refactor/swiftui-p1` | SwiftUI 第一阶段重构 | `c2f0524` | 17 files，+102/−403 | 0 ahead / 3 behind（已合并） |

> 注意：上表“文件数/行数”是 `git diff origin/main..origin/<branch>` 的原始输出。对 5 个已合并分支，这个命令实际显示的是“把 main 退回该分支”的反向差异（大量删除），**不是分支新增代码**；它们相对 merge-base 的新增内容已经包含在 main 里。

判断一个分支是否已合并，不要看 `git diff --stat`，要看 `git rev-list --left-right --count origin/main...origin/<branch>`：第一个数字是 main 独有提交数（branch 落后多少），第二个是 branch 独有提交数（branch 领先多少）。本文表格就是按这个口径填的；`git diff` 只用来辅助看文件范围。另一个常见误区是把 `git diff main..branch` 当成“branch 新增”，实际上两点 diff 同时包含“branch 少了 main 的提交”，所以已合并分支会出现大量删除行。

## 证据

- 分支元数据：`D:\FlyForkFork\_cache\work\mac-everything\work.json` 的 `branches` 数组，记录了 7 个分支的 `sha`、`ahead`、`behind`、`files_changed`、`insertions`、`deletions`。
- 本地复核命令（2026-11-07 执行）：`git -C D:\FlyForkFork\mac-everything rev-list --left-right --count origin/main...origin/<branch>` 与 `git -C D:\FlyForkFork\mac-everything diff --shortstat origin/main..origin/<branch>`。
- 发布分支的净改动：`git -C D:\FlyForkFork\mac-everything diff --stat origin/main...origin/claude/release-workflow`，7 files changed, 517 insertions(+), 5 deletions(-)；涉及 `.github/workflows/release.yml:1-75`、`.github/workflows/pr-build.yml:13-40`、`Makefile` 与 `scripts/release/*.sh`。
- commit URL 模式：`https://github.com/YuSec2021/mac-everything/commit/<sha>`；main 基线为 `https://github.com/YuSec2021/mac-everything/commit/70bbad53dcd4fff07aeccef89c826f576c75e1e5`。

## 默认分支 vs 其他分支

- **main**：最新代码，包含 7 个分支中除 `claude/release-workflow` 外的全部工作。HEAD 是 2026-11-06 的 merge commit（`70bbad53`）。
- **claude/release-workflow**：唯一还没进 main 的分支。它从 `ca51901` 分出，带 2 个提交，相对 merge-base 的净改动是 **7 files, +517/−5**：`.github/workflows/release.yml`（208 行）、`Makefile`（+19/−5）、`docs/release.md`（99 行，仅该分支存在）、`scripts/release/{bundle_dylibs,notarize,sign_app,verify_app}.sh`。这是发布工程，不是引擎功能。
- **其余 5 个**：HEAD 都是 main 的祖先，`git log origin/main..origin/<branch>` 为空。它们只适合用来读历史实现，不应再从这些分支拉代码。

分支命名能看出工作流：`ci/` 是流水线，`fix/` 是缺陷修复，`refactor/` 是重构，`claude/`、`codex/` 是 AI 助手生成的改动。5 个已合并分支全部是 `fix/`、`refactor/`、`codex/` 前缀，说明它们已经走完“分支 → 合并”的生命周期；只有 `claude/release-workflow` 还停在待评审状态，且它改的是发布工程而不是运行时逻辑。

## 关键 commit

| commit | 分支 | 内容 |
|---|---|---|
| `5cf1b75` | `claude/release-workflow` | `ci: build, sign and publish releases from v* tags`——v* tag 触发签名/公证/发布 |
| `fd3789a` | `claude/release-workflow` | `ci: use Node 24 versions of checkout and upload-artifact`——升级 Actions 运行时 |
| `70bbad53` | main | Merge PR #8（`codex/sync-about-changelog`），当前分析基线 |
| `ca51901` | main | Merge PR #1（`claude/angry-khayyam-86886a`），release 分支的 merge-base |

`claude/release-workflow` 的实际 diff 可直接跑：

```bash
git -C D:\FlyForkFork\mac-everything diff origin/main...origin/claude/release-workflow --stat
# 7 files changed, 517 insertions(+), 5 deletions(-)
```

## 对 API/协议/平台的影响

| 分支 | 对 HTTP API | 对索引格式 | 对 macOS 版本 | 对构建 |
|---|---|---|---|---|
| `claude/release-workflow` | 无 | 无 | 无 | 新增 `.github/workflows/release.yml` 的 v* tag 发布、签名、公证、DMG 校验和；需要 Apple 证书/公证凭据 |
| `ci/release-dmg` | 无 | 无 | 无 | PR 构建矩阵：arm64 `macos-15` + x86_64 `macos-15-intel`（`.github/workflows/pr-build.yml`） |
| `fix/index-rewrite-amplification` | 无 | 可能改 WAL/重写节奏 | 无 | `make test` 回归 |
| `fix/root-rescan-duplicates` | 无 | 无 | 无 | `make test` 回归 |
| `refactor/swiftui-p1` | 无 | 无 | 无 | Xcode 构建 |

结论：**当前唯一值得评审的未合并分支是 `claude/release-workflow`，且它只影响发布流水线**。如果你的目标是改搜索/索引，直接基于 main 开分支即可。

## 读代码建议

1. 先读 main 的 `MacEverything/Core/ServiceEngine.cpp` 和 `MacEverything/Core/SearchEngineAdvancedQuery.cpp`，建立当前实现基线。
2. 想理解“发布怎么做的”，只看 `claude/release-workflow` 的 7 个文件，不要被 77 files 的两点 diff 吓到——其中大部分是 main 后来新增、该分支没有的内容。
3. 想理解历史优化，按 commit 读 main 里的合并记录，而不是在已合并分支上 `git diff main..branch`。
4. 不要在 5 个已合并分支上开新工作；它们落后 main 11–15 个提交，合并冲突只会增加成本。

**一句话记住：** 7 个分支里 6 个已经是历史，唯一活的 `claude/release-workflow` 只补发布流水线，不碰引擎。
