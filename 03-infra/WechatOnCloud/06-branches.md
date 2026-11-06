# 06 分支：10 个分支里只有 1 个还值得看

> 这篇回答什么问题：这 10 个分支哪些是老分支、哪些已经合进 main、哪个还有未合并的活？读码/合并时该关注什么？

## 先给结论

`origin/main` 已经包含了 8 个分支的全部提交（都是它的祖先），**唯一未合并的是 `claude/project-issue-review-f7c99z`**（12 个提交、真实待合 diff 24 个文件）。其余分支要么是已合并的 PR 分支，要么是老版本快照，读它们不如直接读 main。

## 全量分支表（数据来自 work.json + git 实测）

| 分支 | SHA（40 位） | ahead / behind | diffstat（work.json） | 状态 | 结论 |
|---|---|---|---|---|---|
| `main` | `86d82519c5e6b28aae7ef3caa279086afa244d4d` | 0 / 0 | — | 默认分支 | 分析基线 |
| `claude/project-issue-review-f7c99z` | `28c9e51a81f494899b538d45bcb3381e95d57afc` | 12 / 33 | 37 files, +6109 / −6496 | **未合并** | 唯一有独立价值 |
| `design/impeccable-refine` | `3f4b606cb50fba9a94019d1747ea7406d7f3264a` | 0 / 12 | 11 files, +984 / −2216 | 已合并（祖先） | 可忽略 |
| `design/redesign-v2` | `1513bbaaeb2e402950c1394ab882d9ed6b9c9f57` | 0 / 1 | 空 | 已合并（main 的父提交） | 可忽略 |
| `feat/kasmvnc-152-single-viewer` | `3642608814ff7fd5f14a4e9759d3d0cc9973a5ea` | 0 / 14 | 14 files, +1395 / −2753 | 已合并（PR #172） | 可忽略 |
| `feat/v1.2.0-multi-app` | `167a80a0c384eb7684007aa187196ba4225b43b9` | 0 / 157 | 63 files, +1643 / −12348 | 已合并（老版本） | 历史快照，可忽略 |
| `fix/129-create-failure-visible` | `60b8ef5ae7ef28044ec8061e1382a977101e920c` | 0 / 25 | 26 files, +1558 / −4000 | 已合并（PR #167） | 可忽略 |
| `fix/155-seamless-input-latency` | `6859189ac72ecd7dc206d2dc6b1814034eae4e68` | 0 / 25 | 27 files, +1592 / −4335 | 已合并 | 可忽略 |
| `fix/165-159-paste-pipeline` | `82f86d9a137814ef4f89df7414adc6b39b38230b` | 0 / 24 | 26 files, +1568 / −3998 | 已合并（PR #170） | 可忽略 |
| `fix/166-cef-crash-diagnostics` | `34abb08e6631274454e3f00e227746004b8e9dec` | 0 / 26 | 26 files, +1595 / −3774 | 已合并（PR #169） | 可忽略 |

> 说明：work.json 的 diffstat 是「分支相对当时 main」的原始统计。判断一个分支还有没有待合并内容，必须用三点 diff `git diff origin/main...origin/<branch>`：已合并分支此命令为空；两点 diff `origin/main..origin/<branch>` 会把 main 后来新增的内容反向算进来，不能当待合并量。

## 唯一未合并分支：`claude/project-issue-review-f7c99z`

### 实际 diff 规模

| 口径 | 文件数 | 增 / 删 | 说明 |
|---|---|---|---|
| `git diff --stat origin/main...origin/<branch>`（三点，merge-base 对比） | 24 | +5910 / −3478 | 真正的「待合并改动」 |
| `git diff --stat origin/main..origin/<branch>`（两点，含 main 前进的反向差异） | 37 | +6109 / −6496 | work.json 的口径；包含 main 后来删掉的内容 |

改动集中在：`panel/web/src/styles.css`（4721 行变动，UI 重做）、`panel/web/src/ui.tsx`（404 行）、`panel/server/src/docker.ts`、`panel/server/src/index.ts`、`docker/Dockerfile`、`docker/app-ctl.sh`、`docker/autostart`，并新增 `docker/woc-xlock.sh`。

### 关键 commit（12 个里的代表）

| commit | 内容 | 价值 |
|---|---|---|
| `28c9e51a81f494899b538d45bcb3381e95d57afc` | 浏览器实例卡片显示 Chromium 版本号 | 诊断信息前移 |
| `4f8b159` | 桌面卡住识别补全；镜像不在本机时改为原地重启，不删实例 | 生命周期安全 |
| `4cde812` | 启动时清掉非正常退出残留的 X 显示锁 | 断电/强杀后不再一直「连接中」 |
| `89b9bd3` | 无感输入中文转发期间按下的键排到中文之后（#155） | 输入顺序 |
| `1116195` | 安装结束误判 | 微信安装状态机 |
| `4d3b012` | 换设备时窗口挪回屏内 | 多端体验 |

### 合并前必须核对的点

1. **重复修复**：12 个提交里有多个与 main 的 PR（#155/#165/#159/#166）主题重叠。main 可能已经用另一种实现修过，直接 merge 会产生语义冲突，不是文本冲突。
2. **大 UI 重做**：styles.css 4721 行变动，合并成本高；需要设计走查。
3. **新文件 `docker/woc-xlock.sh`**：要确认它被 Dockerfile COPY 且有执行位，否则死代码。
4. **时间基准**：分支 tip 是 2026-10-01，落后 main 33 个提交，不能直接当最新代码用。

## 其它分支为什么可以忽略

- **已合并（祖先）**：`design/impeccable-refine`、`design/redesign-v2`、`feat/kasmvnc-152-single-viewer`、`fix/129`、`fix/155`、`fix/165-159`、`fix/166` 的 tip 都是 main 的祖先；`git merge-base --is-ancestor` 全部为真。
- **老版本快照**：`feat/v1.2.0-multi-app` behind 157，是 2026-06 的多应用开发分支，内容已被后续 main 完全吸收；只在考古「多应用最初怎么设计」时有价值。
- **behind 数不是落后债务**：已合并分支的 behind 只是「合并后 main 又走了多少」，不代表分支有未同步工作。

## 读码建议

- 想理解现状：只看 `main`，不要看分支。
- 想捡未合并修复：只看 `claude/project-issue-review-f7c99z`，按 commit 逐个 `git show`，不要整分支 merge。
- 想看 KasmVNC 单连接设计演进：看 `feat/kasmvnc-152-single-viewer` 的 `3642608814ff7fd5f14a4e9759d3d0cc9973a5ea`（已进 main，但 commit 本身信息量大）。

## 风险

| 风险 | 说明 |
|---|---|
| 误把已合并分支当待合并 | behind 数很大容易误判；先跑 `git merge-base --is-ancestor origin/<b> origin/main` |
| claude 分支直接 merge | 12 个提交与 main 的修复重叠，易产生语义回退 |
| 分支级 diffstat 口径混淆 | work.json 是两点 diff；判断待合并量必须用三点 diff |
| 老分支含过期安全配置 | `feat/v1.2.0-multi-app` 时代的 compose/环境变量与现在不同，不要照抄 |

## 一句话记住

10 个分支里，8 个已并入 main（其中 `design/redesign-v2` 就是 main 的父提交）、1 个是 main 本身，**只有 claude 分支还活着**——而且它最该做的是逐 commit 挑拣，不是 merge。
