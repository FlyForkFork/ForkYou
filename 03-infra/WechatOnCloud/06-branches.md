# 06 分支：10 个分支里只有 1 个还值得看

> 这篇回答什么问题：这 10 个分支哪些是老分支、哪些已经合进 main、哪个还有未合并的活？读码/合并时该关注什么？

## 先给结论

`origin/main`（`86d82519`）已经包含了 8 个分支的全部提交（都是它的祖先），**唯一未合并的是 `claude/project-issue-review-f7c99z`**：12 个提交、真实待合 diff 24 个文件 +5910/−3478。其余分支要么是已合并的 PR 分支，要么是老版本快照，读它们不如直接读 main。

## 全量分支表（work.json + 本地 git 实测）

| 分支 | SHA（40 位） | ahead / behind | work.json diffstat | 状态 | 结论 |
|---|---|---|---|---|---|
| `main` | `86d82519c5e6b28aae7ef3caa279086afa244d4d` | 0 / 0 | — | 默认分支 | 分析基线 |
| `claude/project-issue-review-f7c99z` | `28c9e51a81f494899b538d45bcb3381e95d57afc` | 12 / 33 | 37 files, +6109 / −6496 | **未合并** | 唯一有独立价值 |
| `design/impeccable-refine` | `3f4b606cb50fba9a94019d1747ea7406d7f3264a` | 0 / 12 | 11 files, +984 / −2216 | 已合并（祖先） | 可忽略 |
| `design/redesign-v2` | `1513bbaaeb2e402950c1394ab882d9ed6b9c9f57` | 0 / 1 | 空 | 已合并（main 的父提交） | 可忽略 |
| `feat/kasmvnc-152-single-viewer` | `3642608814ff7fd5f14a4e9759d3d0cc9973a5ea` | 0 / 14 | 14 files, +1395 / −2753 | 已合并（PR #172） | 可忽略 |
| `feat/v1.2.0-multi-app` | `167a80a0c384eb7684007aa187196ba4225b43b9` | 0 / 157 | 63 files, +1643 / −12348 | 已合并（老版本快照） | 只值考古 |
| `fix/129-create-failure-visible` | `60b8ef5ae7ef28044ec8061e1382a977101e920c` | 0 / 25 | 26 files, +1558 / −4000 | 已合并（PR #167） | 可忽略 |
| `fix/155-seamless-input-latency` | `6859189ac72ecd7dc206d2dc6b1814034eae4e68` | 0 / 25 | 27 files, +1592 / −4335 | 已合并 | 可忽略 |
| `fix/165-159-paste-pipeline` | `82f86d9a137814ef4f89df7414adc6b39b38230b` | 0 / 24 | 26 files, +1568 / −3998 | 已合并（PR #170） | 可忽略 |
| `fix/166-cef-crash-diagnostics` | `34abb08e6631274454e3f00e227746004b8e9dec` | 0 / 26 | 26 files, +1595 / −3774 | 已合并（PR #169） | 可忽略 |

验证命令与结果：

```bash
git rev-list --count origin/main..origin/<branch>   # ahead
git rev-list --count origin/<branch>..origin/main   # behind
git merge-base --is-ancestor origin/<branch> origin/main
git diff --stat origin/main...origin/<branch>       # 三点 diff，已合并分支为空
```

9 个非 main 分支中，8 个 `--is-ancestor` 为真且三点 diff 为空；只有 `claude/…` 非祖先。

> **口径警告**：work.json 的 diffstat 是「分支相对当时 main」的两点统计。判断还有没有待合并内容必须用三点 diff（merge-base 对比）：已合并分支此命令为空；两点 diff 会把 main 后来新增的内容反向算成「分支删除」，不能当待合并量。

## 分支为什么长成这样

这 10 个分支的命名本身就是一份工作流记录，读一遍比看 diff 更快理解项目的协作方式：

- `design/*` 两条（`impeccable-refine`、`redesign-v2`）说明 UI 有独立的评审节奏，重做走分支、不直接在 main 上改；`redesign-v2` 最终以 merge commit 的形式成为 main 的父提交（`86d8251` 的 subject 就是 `Merge pull request #174 from Gloridust/design/redesign-v2`）。
- `feat/*` 两条是特性分支：`feat/v1.2.0-multi-app` 是「多应用」的第一版（behind 157，老到连 `crash-diag.ts`、`upload.ts`、`docker-compose.secure.yml` 都还没出现），`feat/kasmvnc-152-single-viewer` 是 KasmVNC 1.5.2 + 单连接的迁移。
- `fix/*` 四条全部以 issue 编号命名（#129 创建失败可见、#155 无感输入延迟、#165/#159 粘贴管线、#166 CEF 崩溃诊断），说明这个项目的修 bug 流程是「issue → 分支 → PR → merge」，且每条都有可追溯的现场。
- `claude/project-issue-review-f7c99z` 是唯一一个「AI 参与的项目级 review」分支：12 个提交横跨 UI 重做、稳定性、安装状态机、QQ 下载链路，粒度比单个 fix 分支粗得多。

这个结构值得学的不是命名规范，而是**「一个分支只回答一个问题」**——除了 claude 那条，其余 9 条都能用一句话说清它要解决什么。

## 唯一未合并分支：`claude/project-issue-review-f7c99z`

### 实际 diff 规模

| 口径 | 文件数 | 增 / 删 | 说明 |
|---|---|---|---|
| `git diff --stat origin/main...origin/<branch>`（三点） | 24 | +5910 / −3478 | 真正的「待合并改动」 |
| `git diff --stat origin/main..origin/<branch>`（两点） | 37 | +6109 / −6496 | work.json 的口径；含 main 前进后的反向差异 |

改动集中在：`panel/web/src/styles.css`（4721 行变动，UI 重做）、`panel/web/src/pages/Admin.tsx`（1787）、`panel/web/src/pages/Desktop.tsx`（681）、`panel/web/src/AppShell.tsx`（343）、`panel/web/src/ui.tsx`（404）、`panel/web/src/icons.tsx`（405）、`panel/server/src/docker.ts`（289）、`docker/app-ctl.sh`（258）、`panel/server/src/index.ts`（100），并新增 `docker/woc-xlock.sh`（13 行）。

### 12 个 commit 逐个看

| commit | 内容 | 价值判断 |
|---|---|---|
| `28c9e51` | 浏览器实例卡片显示 Chromium 版本号 | 诊断信息前移，独立可用 |
| `4f8b159` | 桌面卡住识别补全；镜像不在本机时改为**原地重启**，不删实例 | 生命周期安全，与 main 的 `keepImage` 思路同源但实现不同 |
| `4cde812` | 启动时清掉非正常退出残留的 X 显示锁（新增 `woc-xlock.sh`） | **真实故障**：强杀 Docker 后 11 个实例里 2 个因锁里 pid 被 nginx/s6 复用而起不来 |
| `89b9bd3` | 无感输入中文转发期间按下的键排到中文之后（#155） | 与 main 已修的 #155 主题重叠 |
| `1116195` | 安装恰好结束时不再误判成「上次安装被中断」 | 与 main 的 `print_status` 启发式相关，需比对语义 |
| `82d8bcf` | 下拉菜单滚动跟随；卡片菜单去空分组 | 纯 UI |
| `7fc6e63` | QQ 新建提示写清「上传安装包」在哪 | 纯文案 |
| `83ce89f` | 「连接中」提示排版 | 纯 UI |
| `4d3b012` | 换设备后把跑出屏幕的窗口挪回屏内 | 多端体验 |
| `408de4d` | 界面全面改版（「牛奶布艺 2.0」） | 大 UI 重做，合并成本主要来自它 |
| `0113b5d` | 整卷恢复改为「还原」：先挪开、成功删、失败挪回 | 数据安全，值得单独挑 |
| `2232891` | QQ 官网地址被拒时改用 AUR 记录地址，支持上传安装包（#153） | 与 main 的签名链方案不同路径 |

### 合并前必须核对的点

1. **语义冲突多于文本冲突**：`#155`、`#165/#159`、`#166` 主题在 main 已有另一种实现（`fix/155-seamless-input-latency`、`fix/165-159-paste-pipeline`、`fix/166-cef-crash-diagnostics` 都已合并）。直接 merge 会「编译通过、行为回退」。
2. **大 UI 重做**：`styles.css` 4721 行变动，需要设计走查，且与 `design/impeccable-refine` 的意图重叠。
3. **新文件 `docker/woc-xlock.sh`**：要确认它被 `Dockerfile` COPY 到 `/custom-cont-init.d/03-*` 且有执行位，否则是死代码。这是全分支里**最值得单独 cherry-pick** 的一项。
4. **时间基准**：分支 tip 落后 main 33 个提交，不能当最新代码读。
5. **`0113b5d` 的卷还原语义**：先挪开再写，失败挪回——比 main 当前实现更安全，但需要确认与 `volJobs` 状态机兼容。

## 其它分支为什么可以忽略

- **已合并（祖先）**：`design/impeccable-refine`、`design/redesign-v2`、`feat/kasmvnc-152-single-viewer`、`fix/129`、`fix/155`、`fix/165-159`、`fix/166` 的 tip 都是 main 的祖先。
- **老版本快照**：`feat/v1.2.0-multi-app` behind 157，是多应用最初的设计分支；其中 `crash-diag.ts`、`logs.ts`、`self-update.ts`、`tar.ts`、`upload.ts`、`version.ts`、`docker-compose.secure.yml` 都还不存在（这些文件后来才加），只在考古「多应用最初怎么设计」时有价值。
- **behind 数不是落后债务**：已合并分支的 behind 只是「合并后 main 又走了多少」，不代表分支有未同步工作。

## 读码建议

- 想理解现状：只看 `main`。
- 想捡未合并修复：只看 `claude/…`，按 commit 逐个 `git show`，**不要整分支 merge**。
- 想看 KasmVNC 单连接设计演进：看 `feat/kasmvnc-152-single-viewer` 的 `3642608`（已进 main，但 commit message 信息量大）。
- 想理解「为什么现在这么设计」：`doc/dev/架构守则.md` 比任何分支都值钱。

## 风险

| 风险 | 说明 | 规避 |
|---|---|---|
| 误把已合并分支当待合并 | behind 数很大容易误判 | 先跑 `git merge-base --is-ancestor` |
| claude 分支直接 merge | 与 main 的 #155/#159/#166 修复重叠，易语义回退 | 逐 commit cherry-pick + 手工验证 |
| diffstat 口径混淆 | work.json 是两点 diff | 判断待合并量用三点 diff |
| 老分支含过期配置 | `feat/v1.2.0-multi-app` 时代的 compose/env 与现在不同 | 不要照抄 |
| `woc-xlock.sh` 未被 COPY | 新文件没进镜像就是死代码 | 检查 `docker/Dockerfile` 的 COPY 与 chmod |

## 一句话记住

10 个分支里，8 个已并入 main（`design/redesign-v2` 就是 main 的父提交）、1 个是 main 本身，**只有 claude 分支还活着**——而它最该做的是逐 commit 挑拣（尤其 `4cde812` 的 X 锁清理与 `0113b5d` 的卷还原），不是 merge。
