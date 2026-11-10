# 06 分支：差异、风险、该读哪个

> 这篇回答什么问题：5 个分支之间到底差什么，哪个还活着，哪个只是历史。

## 分支列表

数据来自 `git -C D:\FlyForkFork\mac-everything rev-list --left-right --count origin/main...origin/<branch>` 与 `git diff --shortstat origin/main...origin/<branch>`（2026-11-10 执行）。

| 分支 | HEAD | 领先/落后 main | 三点 diff（真实改动） | 状态 |
|---|---|---|---:|---|
| `main` | `0db6b60` | 0 / 0 | — | 基准，分析 commit |
| `claude/release-workflow` | `fd3789a` | 2 / 25 | 7 files，+517/−5 | **未合并**，2026-10-22 起停滞 |
| `fix/rebuild-index-v6` | `8ebc85f` | 1 / 0 | 13 files，+184/−44 | **未合并**，基于当前 main |
| `claude/trusting-dirac-c373be` | `646eaf2` | 0 / 1 | 空（已并入 main） | 已合并（PR #11） |
| `fix/persist-content-settings` | `46b2472` | 0 / 3 | 空（已并入 main） | 已合并（PR #10） |

> **读法警告**：`git diff origin/main..origin/<branch>` 是两点 diff，对已合并分支会显示大量删除（例如 `fix/persist-content-settings` 显示 7 files +76/−914），因为那是“把 main 退回该分支”的反向差异。判断真实改动要用三点 diff `origin/main...origin/<branch>`，判断是否合并要用 `git rev-list --left-right --count`。

## 唯一还在演进的未合并分支：fix/rebuild-index-v6

`8ebc85f` “fix: make Rebuild Index discard the v6 cache and rescan”，基于 `0db6b60`，领先 1 个提交、落后 0 个。三点 diff 13 个文件 +184/−44：

| 文件 | 改动 |
|---|---|
| `MacEverything/Core/ServiceEngine.cpp` | +45：新增 `rebuildIndex`，扫描/同步中拒绝、停旧 persistence、删缓存文件后重新全盘扫描 |
| `MacEverything/Core/ServiceEngine.h` | +4：方法声明 |
| `MacEverything/Core/ServiceEngine+Content.cpp` | +17/−：内容索引重建路径对齐 |
| `MacEverything/App/SearchViewModel.swift` | +50/−：改走 bridge，不再自己删文件 |
| `MacEverything/Bridge/MacSearchBridge.h/.mm` | +14：暴露 `rebuildIndex` |
| `MacEverything/App/AppDelegate.swift` | +7：菜单接线 |
| `MacEverything/CLI/daemon_main.cpp` | +3 |
| `tests/test_service_engine.h` | +61：Part 40 新增 12 项 |
| `docs/changelog/155-rebuild-index-discards-v6.md` | 新增 17 行 |
| `MacEverything/App/AboutView.swift`、`docs/changelog/153…`、`docs/changelog/README.md` | 同步版本说明与索引 |

为什么这个分支重要：main 上“重建索引”有两条路径，都不真正重建 v6。GUI 菜单删的是 `index.bin/index.wal/index.pages/index.ptable`（`MacEverything/App/SearchViewModel.swift:214-218`），没删优先级最高的 `index.v6`；HTTP 接口只发一个没有监听者的本地通知（`MacEverything/Core/HttpServer.cpp:585-590`、`MacEverything/Bridge/MacSearchBridge.mm:231-234`）。而这个分支正是 1.4.0 事故（`docs/changelog/153`）之后，用户恢复损坏索引唯一需要的能力。`docs/changelog/153-overlapping-compaction-index-loss.md` 明确写“已损坏的本地索引不会自动恢复，升级后需要执行一次 Rebuild Index”——如果 Rebuild 本身在 main 上不生效，这条恢复路径是断的。

## 另一个未合并分支：claude/release-workflow

`fd3789a`，落后 main 25 个提交，2026-10-22 之后再无提交。三点 diff 只有 7 个文件 +517/−5：

- `.github/workflows/release.yml`（+208）：v* tag 触发构建、签名、公证、发布
- `Makefile`（+19/−5）
- `docs/release.md`（+99，仅该分支存在）
- `scripts/release/bundle_dylibs.sh`（+91）、`notarize.sh`（+20）、`sign_app.sh`（+26）、`verify_app.sh`（+59）

这是一套**打包 Homebrew 动态库**的发布方案：把 re2/abseil 的 dylib 塞进 app bundle（约 66 个、4–5 MB），再签名、公证、验证。它和 main 现在的路线不同——main 的 `scripts/build-dmg.sh` 是**静态编译** abseil 20260817.0 + re2 2025-11-05，产出 `dist/MacEverything-<version>-<arch>.dmg`，不需要 bundle dylib。

两条路线并存说明发布工程改过方向：先试 bundle dylib（分支），后改成静态链接（main）。这个分支的价值是“公证/签名/验证脚本长什么样”，而不是“应该合并”。如果直接合并，会与 main 的 `build-dmg.sh` 冲突，且 `docs/release.md` 里用双花括号包裹的模板占位符会触发 ForkYou 的占位符校验规则，不适合直接引用。

## 已合并的两个分支

- **`claude/trusting-dirac-c373be`**（`646eaf2`）：`fix: register MCP clients correctly and harden config writes`，PR #11。落后 main 1 个提交（就是合并它自己的 merge commit），三点 diff 为空。
- **`fix/persist-content-settings`**（`46b2472`）：包含 `a7c9b8f`（内容搜索设置持久化，changelog 152）与 `46b2472`（压缩重叠修复，changelog 153），PR #10。落后 main 3 个提交，三点 diff 为空。

这两个分支都已经在 main 的历史里，**不要在上面开新工作**。

## 关键 commit

| commit | 分支 | 内容 |
|---|---|---|
| `0db6b60` | main | Merge PR #11，当前分析基线 |
| `646eaf2` | main / claude/trusting-dirac-c373be | MCP 客户端注册修正 + 配置写入加固（changelog 154） |
| `823eadf` | main | Merge PR #10（`fix/persist-content-settings`） |
| `46b2472` | main / fix/persist-content-settings | 压缩重叠导致索引被清空（changelog 153） |
| `a7c9b8f` | main | 内容搜索设置跨重启保留（changelog 152） |
| `c88a904` | main | Merge PR #9（`chore/release-1.4.0`） |
| `fe5f26c` | main | 版本升到 1.4.0（Build 4） |
| `8ebc85f` | fix/rebuild-index-v6 | Rebuild Index 丢弃 v6 缓存并重扫 |
| `fd3789a` | claude/release-workflow | CI 升级 Node 24 版 checkout/upload-artifact |

## 对 API/协议/平台的影响

| 分支 | HTTP API | 索引格式 | macOS 版本 | 构建 |
|---|---|---|---|---|
| `fix/rebuild-index-v6` | `POST /api/index/rebuild` 与 GUI 菜单都变成真正重建 | 无变化，但会删 `index.v6/index.wal/index.pages/index.ptable/content_index.*` | 无 | `make test` 回归，Part 40 新增 12 项 |
| `claude/release-workflow` | 无 | 无 | 无 | 新增签名/公证/DMG 校验和；需要 Apple 证书与公证凭据 |
| 两个已合并分支 | 无 | 无 | 无 | — |

## 读代码建议

1. 先读 main 的 `MacEverything/Core/ServiceEngine.cpp` 和 `MacEverything/Core/SearchEngineAdvancedQuery.cpp`，建立当前实现基线。
2. 想理解“重建索引应该怎么做”，只看 `fix/rebuild-index-v6` 的 13 个文件，尤其是 `ServiceEngine.cpp` 的 `rebuildIndex` 与 `tests/test_service_engine.h` 的新增用例。
3. 想理解“发布怎么做的”，看 `claude/release-workflow` 的 7 个文件；但要知道 main 已经换成静态链接路线，这份脚本是历史方案。
4. 想理解历史优化，按 main 里的 merge commit 读，而不是在已合并分支上 `git diff main..branch`。
5. 不要在已合并分支上开新工作；它们落后 main 1–3 个提交，rebase 成本低但没必要。

## 分支考古的三条教训

1. **先看 ahead/behind，再看 diff**：`claude/trusting-dirac-c373be` 和 `fix/persist-content-settings` 的三点 diff 都是空的，但两点 diff 会显示 +76/−914 这样的“大量删除”；那不是代码被删，而是 main 比它们多走了几步。判断是否合并只信 `rev-list --left-right --count`。
2. **分支会过期，问题不会**：`claude/release-workflow` 停在 2026-10-22，落后 25 个提交；它的签名/公证脚本仍有参考价值，但发布路线已经被 main 的静态链接 `build-dmg.sh` 取代。读旧分支要读“当时为什么这么做”，不要读成“现在应该这么做”。
3. **未合并不等于不重要**：`fix/rebuild-index-v6` 只有 1 个提交、184 行新增，却补上了 1.4.0 事故后唯一的用户恢复路径；main 上 GUI 和 HTTP 两条 rebuild 都不生效。分支评审时，先看它修的是不是主干的真实缺口，再看 diff 大小。

## 复现命令

```bash
# 是否已合并（第一列=main 独有，第二列=分支独有）
git -C D:\FlyForkFork\mac-everything rev-list --left-right --count origin/main...origin/fix/rebuild-index-v6

# 真实改动（三点）
git -C D:\FlyForkFork\mac-everything diff --stat origin/main...origin/fix/rebuild-index-v6

# 两点 diff（会包含“main 比分支多出的内容”，已合并分支会显示大量删除）
git -C D:\FlyForkFork\mac-everything diff --shortstat origin/main..origin/claude/release-workflow
```

**一句话记住：** 5 个分支里 3 个已经是历史；真正值得关注的是 `fix/rebuild-index-v6`——它补的是 1.4.0 事故后唯一有效的恢复路径，而这条路径在 main 上目前是断的。
