# 06 分支：`main` 写代码，`update-feed-state` 放发布状态

> 仓库：`oinkvm/oink`。本地 clone 使用 `--no-single-branch --depth 1`，所以 commit 历史是 grafted（浅克隆），但两个分支的树都在。

## 分支总表

| 分支 | HEAD | 类型 | 作用 | 要不要读 |
|---|---|---|---|---|
| `main` | `546f65b` | 默认分支、代码分支 | 产品源码、CI、打包、文档 | **主读** |
| `update-feed-state` | `c120e81` | orphan 状态分支 | 发布 feed 的不可变快照：Windows/macOS 更新清单、release 记录、站点 | 只在研究更新机制时读 |

```bash
git -C oink branch -a
# * main
#   remotes/origin/HEAD -> origin/main
#   remotes/origin/main
#   remotes/origin/update-feed-state
```

## `main`

- 默认分支，`origin/HEAD -> origin/main`。
- HEAD commit：`546f65b2135e7a1491d2d743f0a1e072a74df36f`，提交信息 `fix(update): verify canonical feed visibility before committing deployment`。
- 包含全部源码、`crates/`、`apps/`、`packaging/`、`.github/workflows/`。
- CI 在 push 到 `main` / PR 时运行（`.github/workflows/ci.yml:1-8`）。

## `update-feed-state`

这是一个**孤儿分支**（orphan branch）：它和 `main` 没有共同祖先，只存发布状态，不存源代码。不要把它当功能分支合并。

### 它有什么

`git ls-tree -r --name-only origin/update-feed-state` 的顶层：

```text
pending-renewal.json
records/*.json              # 发布记录，按哈希命名
registry.json               # feed 注册表
site/CNAME                  # 自定义域名
site/heartbeat.json         # 站点心跳
site/index.html             # 下载页
site/mac/v1/mac-2026-01/{beta,stable}/appcast.xml
site/windows/releases/{31,32,33,34,35,36,43,79,84,93,100}/release.json
site/windows/v1/win-2026-01/{beta,stable}/manifest.json
```

共 32 个文件。`records/*.json` 是每次发布的元数据（版本、tag、build、包 URL、sha256、签名等）；`site/` 是 GitHub Pages 实际发布的更新 feed。

### 谁写它

- `.github/workflows/publish-windows-feed.yml`：`Publish Windows feed`，`workflow_call`，需要 `UPDATE_FEED_WRITER_TOKEN` 和 Windows Ed25519 私钥；流程是 gate → prepare（绑定 release tag 与源码树）→ sign（签名包/注册/预留序列/签 manifest）→ deploy。
- `.github/workflows/deploy-feed.yml`：`Deploy verified platform feed`，把候选 feed 合并到受保护快照，上传 Pages artifact，部署后**读回**（readback）并 CAS 提交；失败自动回滚并验证回滚字节。
- 还有 `publish-macos-feed.yml`、`renew-windows-update-manifests.yml`、`seed-update-feeds.yml`、`bootstrap-update-site.yml`。

这说明 `update-feed-state` 不是人手改的，是 CI 的**发布事务日志/站点快照**。

### diff 为什么看起来“删了 3975 个文件”

在浅克隆上执行：

```bash
git diff --stat main..origin/update-feed-state
# 3975 files changed, 497 insertions(+), 670579 deletions(-)
```

这不是“发布分支删了代码”，而是**孤儿分支与 main 没有共同祖先**：Git 把 main 的所有文件都视为“被删除”，只把 update-feed-state 的 32 个文件视为“新增”。所以这个 stat 不能当“代码变更量”看。

### 关键 commit

浅克隆只有 grafted 的一个 commit：`c120e81 Publish verified platform feed snapshot`。要看完整历史，需要完整 clone（`git clone` 不带 `--depth`）或 `git fetch --unshallow`。

## 分支差异对分析的影响

1. **读代码只看 `main`**：`update-feed-state` 没有 Rust/TS 源码。
2. **读更新机制看两个地方**：`main` 的 `crates/oink-update/` + `packaging/` + `.github/workflows/*feed*`；`update-feed-state` 的 `site/` 是最终产物。
3. **贡献不要碰 `update-feed-state`**：它是 CI 写入的发布状态，手改会破坏签名/序列号/CAS。

## 建议命令

```bash
# 看两个分支的树差异（只列文件名）
git -C oink diff --name-status main..origin/update-feed-state | head -50

# 看 update-feed-state 的站点结构
git -C oink ls-tree -r --name-only origin/update-feed-state

# 看 main 的更新相关代码
ls oink/crates/oink-update/src
ls oink/.github/workflows | grep feed

# 看发布工作流
sed -n '1,120p' oink/.github/workflows/publish-windows-feed.yml
sed -n '1,100p' oink/.github/workflows/deploy-feed.yml
```

## 风险与待查实

- 浅克隆导致 commit 历史不完整；本文的 commit 结论只基于当前 HEAD 和可见的 grafted 记录。
- `update-feed-state` 的签名/序列号细节需要读 `build-support/update/` 才能完全确认；本文只确认了工作流和文件布局。
- 分支保护规则（是否禁止直接 push）未通过 API 查证；从工作流使用 `UPDATE_FEED_WRITER_TOKEN` 看，至少写入是受控的。

## 关键证据

- 分支列表/HEAD：`git branch -a`、`git log --oneline --all`
- 孤儿分支文件：`git ls-tree -r --name-only origin/update-feed-state`
- diff stat：`git diff --stat main..origin/update-feed-state`
- Windows feed 工作流：`.github/workflows/publish-windows-feed.yml`
- 部署/回滚：`.github/workflows/deploy-feed.yml`
- 更新代码：`crates/oink-update/src/`
