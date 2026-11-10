# 06 分支：差异、风险、该读哪个

> 这篇回答：三条分支到底差什么、为什么差、读代码时该以哪条为准。

## 分支列表

| 分支 | 用途 | HEAD | 文件数 | ahead / behind |
|---|---|---|---|---|
| `main` | 发布主线，v1.2.1 | `5f88442961ad9cdac50af4421cf76b3ac06d64e2` | 147 | 0 / 0 |
| `codex/fix-ios-build` | 修 iOS 构建，同时回退播放接口 | `d251486861e269ebf74d0a28a5de07739c0ea8ce` | 9 改动 | 1 / 1 |
| `codex/source-only-maintenance` | 「只维护源码」立场的演示 | `c5cec6b4d62827911d9951acd88ed0fb1d01dc4c` | 8 改动 | 1 / 1 |

`main` 的 HEAD commit：`5f88442 chore: bump version to 1.2.1 [skip ci]`。

## 默认分支 vs 其他分支

### 一个必须先说清的技术前提

三条分支之间**没有 merge base**。shallow clone（`depth=1`）导致 `git merge-base` 返回空，`git rev-list --left-right --count` 给出 1/1，`git diff origin/main...origin/codex/fix-ios-build` 直接报 `fatal: no merge base`。

所以下面的 diff 数据全部来自**两点 diff**（`git diff origin/main origin/<branch>`），它反映的是「两个快照的内容差异」，**不等于**「这条分支基于 main 改了什么」。阅读时要记住这个限制：某些差异可能是分支落后于 main 造成的，而不是分支主动改的。

### `codex/fix-ios-build` vs `main`

**9 files changed, +161 / −160**

| 文件 | 变化 |
|---|---|
| `README.md` | 大幅改写（+199 行量级），加入维护范围与非商业立场段落 |
| `package.json` | version `1.2.1` → `1.2.0` |
| `src-tauri/Cargo.toml` | version `1.2.1` → `1.2.0` |
| `src-tauri/Cargo.lock` | 随版本号联动 |
| `src-tauri/tauri.conf.json` | version `1.2.1` → `1.2.0` |
| `src-tauri/src/api.rs` | 删除 `Api::post`、`normalize_play_info`、`has_play_url` 及两个单测；`api_play` 只保留 GET 回退路径 |
| `src-tauri/src/net.rs` | `edge_operation` 去掉 `ends_with("/playback")`；`can_retry` 去掉 `(POST && operation=="play")`；删 playback 相关测试 |
| `src/components/Feed.tsx` | 删除 `playTry` 重试状态、「视频暂时无法加载 / 重新加载」覆盖层；`useEffect` 依赖回退为 `[curId, curEp]` |
| `src/types.ts` | 删除 `PlayInfo.streams` 字段 |

**分支名与内容不符**，这是最值得注意的一点。分支叫 `fix-ios-build`，commit message 是 `fix(ci): resolve Swift compatibility libraries from the Xcode toolchain`，但 `.github/workflows` 的 diff **为空**（`git diff --stat origin/main origin/codex/fix-ios-build -- .github` 无输出）。

也就是说：**这条分支上没有任何 CI 配置改动**。CI 修复可能已经通过其他方式进了 main（推断：commit message 描述的动作发生在分支历史里，但两点 diff 看不到，因为它已在 main 的祖先中）。

真正的内容差异是「回退新播放接口」+「改 README」。

### `codex/source-only-maintenance` vs `main`

**8 files changed, +10 / −112**

| 文件 | 变化 |
|---|---|
| `package.json` / `Cargo.toml` / `Cargo.lock` / `tauri.conf.json` | version 回退到 `1.2.0` |
| `src-tauri/src/api.rs` | 同上的删除（`Api::post`、`normalize_play_info`、`has_play_url`） |
| `src-tauri/src/net.rs` | 同上的删除（`/playback` 分支、POST play 重试、测试） |
| `src/components/Feed.tsx` | 同上的删除（`playTry`、错误覆盖层） |
| `src/types.ts` | 删除 `PlayInfo.streams` |

**代码删除与 `fix-ios-build` 完全相同，但不改 README。**

commit message 是 `docs: clarify maintenance scope and noncommercial position [skip ci]`——描述的是文档动作，实际 diff 里却是代码删除。这个矛盾本身就说明了分支的用途：它可能是「如果只维护源码，会删掉哪些东西」的**演示**，而不是一个要合并的分支。

推断依据：两条分支的 behind 都是 1（都落后 main 一个 commit，即版本 bump），说明它们都从 main 的前一个版本拉出。

## 关键 commit

| Commit | 分支 | 说明 |
|---|---|---|
| `5f88442` | main | `chore: bump version to 1.2.1 [skip ci]` |
| `d251486` | codex/fix-ios-build | `fix(ci): resolve Swift compatibility libraries from the Xcode toolchain` |
| `c5cec6b` | codex/source-only-maintenance | `docs: clarify maintenance scope and noncommercial position [skip ci]` |

注意两条 codex 分支的 commit message 都带 `[skip ci]`（c5cec6b）或描述 CI 修复（d251486）——这与 README 里「不再主动跟进上游播放链路适配」的声明是呼应的。

## 对 API/协议/平台的影响

两条分支删除的东西，逐项看影响：

### 1. `Api::post` 被删

`Api::post` 是 `api.rs:20-40` 里的通用 POST 辅助方法。删掉它意味着 `api_play` 无法再发 `POST /api/videos/{id}/episodes/{ep}/playback`。

**影响**：只剩 GET `/api/videos/{id}/play?ep={ep}&page_texts=0`。如果上游某天只保留新接口，这条分支上的客户端**取不到播放地址**。

### 2. `normalize_play_info` / `has_play_url` 被删

这两个函数是「新旧接口并存期兼容层」（`api.rs:475-497`）。删掉它们意味着不再理解 `streams.{main,hevc}` 结构。

**影响**：如果上游返回的是新结构（只有 `streams`，没有 `video_url`），前端拿到空地址，报「暂无播放地址」。

### 3. `can_retry` 去掉 `(POST && operation=="play")`

`net.rs:515-516` 的 `can_retry` 原本允许「取播放地址的 POST」重试，注释是「取播放地址的 POST 没有副作用」。删掉后，POST 一律不重试。

**影响**：新播放接口的网络抖动不再被自动重试，用户看到失败而不是静默恢复。

### 4. `Feed.tsx` 删除 `playTry` 与错误覆盖层

原本播放地址获取失败时会显示「视频暂时无法加载 / 重新加载」覆盖层，点重试让 `playTry` 递增触发 `useEffect` 重跑。删掉后：

**影响**：失败就是失败，没有 UI 层重试入口。

### 5. `types.ts` 删除 `PlayInfo.streams`

**影响**：类型层面不再承认新接口结构。如果上游返回 `streams`，TS 会报错（如果 strict 检查到位），或者静默丢字段。

### 汇总

两条分支的共同效果是：**把客户端从「兼容新播放接口」回退到「只认旧 GET 接口」**。这与 README 的声明完全一致：

> 维护者后续仅主动维护 UI/UX、交互细节与用户体验，不再主动跟进上游数据获取、解析或播放链路适配。（`README.md`）

换句话说，这两条分支是那条声明的**代码落地**。

## 读代码建议

**默认读 `main`（`5f884429`）**。理由：

1. 它是唯一有完整播放接口兼容层的版本，代表作者当前的工程水平；
2. 两条 codex 分支都是「删除」，信息量更低；
3. 分支无 merge base，diff 本身不可靠，不适合作为理解起点。

**什么时候读 codex 分支**：

- 想理解「如果不跟进上游接口，客户端会退化成什么样」→ 读 `codex/source-only-maintenance`，它的 8 个文件改动就是最小答案；
- 想确认「哪些代码是纯粹为上游接口服务的」→ 看这两条分支删掉的部分，那就是「上游适配层」的边界。

**不要做的事**：

- 不要把这两条分支当成「main 的下一个版本」。它们 behind 1 且未合并，是并行分支而非后继。
- 不要用 `git log main..codex/fix-ios-build` 判断改动——无 merge base 时输出不可靠。
- 不要假设分支名等于内容。`fix-ios-build` 里没有 CI 改动。

## 分支策略观察

三条分支里两条是 `codex/` 前缀，说明作者用 Codex（AI 编码代理）做辅助开发。`codex/source-only-maintenance` 的 commit message 是文档动作但 diff 是代码删除，这种「message 与内容不匹配」在 AI 辅助提交里比较常见——通常是先让 AI 改代码，再补一个描述性 message。

这带来一个实际风险：**分支名和 commit message 都不能作为理解依据**，必须看 diff。这也是为什么本文花了大量篇幅逐项列 diff 而不是引用 commit 描述。

**一句话记住：** 两条 codex 分支都是「减法」——它们删掉的正是 README 里声明不再维护的上游播放接口适配层，所以读它们的目的不是学怎么做，而是学「哪些代码是可割舍的」。
