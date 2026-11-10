# 06 · 分支地图：28 个分支里只有 3 个值得看

**这篇回答什么问题**：仓库有 28 个远端分支，哪些是历史垃圾、哪些还在动、读代码该 checkout 哪个、能不能从别人分支上捡到东西。

## 结论先行

1. 默认分支 `master`，HEAD `77f8d75869acd65f9dba72731b95c7c49ea67bdf`，301 个文件，是唯一值得完整读的分支。
2. 28 个分支里，**24 个是 master 的祖先**（`status=behind`、`ahead_by=0`），也就是"曾经领先、后来被 master 吸收"的 issue 快照，已经没有任何可读增量。
3. 真正 `diverged`（领先 master 且未被吸收）的只有 **3 个**：`claude/issue-371-20260306-0748`、`codex/github-mention-harkmq`、`revert-373-...`。前两个各只改了 1–2 个文件，第三个是一次回滚。
4. `dev` 不是开发主线，它比 master **落后 1 个 commit**，是 77f8d75 那次修复之前的快照。别指望在 dev 上看到新东西。

## 分支全表（GitHub API，2026-11-10 查）

| 分支 | 头 commit | 相对 master | 文件数 | 判断 |
|---|---|---|---|---|
| `master` | 77f8d758 | 基准 | 301 | **读这个** |
| `dev` | 097c9110 | behind 1 | 301 | 落后 master 的快照 |
| `doc` | a7472f41 | behind 225 | 55 | 早期单文件版，已废弃 |
| `claude/issue-200-20250819-0604` | fadb0d94 | behind 286 | — | 祖先，最老的一个 |
| `claude/issue-207-20250822-0707` | 5fa37f02 | behind | — | 祖先 |
| `claude/issue-211-20250827-0632` | 4f51c39c | behind | — | 祖先 |
| `claude/issue-216-20250828-0836` | d185b9d1 | behind | — | 祖先 |
| `claude/issue-219-20250829-1323` | ce016306 | behind | — | 祖先 |
| `claude/issue-220-20250829-1323` | 9869e61b | behind | — | 祖先 |
| `claude/issue-239-20250912-1044` | 45fd4af4 | behind | — | 祖先 |
| `claude/issue-239-20250912-1054` | b9cecbd2 | behind | — | 祖先（同日两次） |
| `claude/issue-253-20250924-0449` | cc216a5a | behind | — | 祖先 |
| `claude/issue-254-20250924-0414` | bd9a6551 | behind | — | 祖先 |
| `claude/issue-259-20251011-0655` | 54f3ded8 | behind 240 | — | 祖先 |
| `claude/issue-260-20251011-0708` | 8b7369b6 | behind | — | 祖先 |
| `claude/issue-266-20251011-0701` | 03fa57fc | behind | — | 祖先 |
| `claude/issue-272-20251027-0249` | f8d8b0ef | behind | — | 祖先 |
| `claude/issue-350-20260304-0754` | 3968b644 | behind 125 | — | 祖先 |
| `claude/issue-352-20260304-0846` | a06bdf18 | behind | — | 祖先 |
| `claude/issue-358-20260228-0238` | 0d32eb37 | behind 139 | — | 祖先 |
| `claude/issue-361-20260303-0625` | 888fe322 | behind | — | 祖先 |
| `claude/issue-364-20260304-0557` | 984e2794 | behind | — | 祖先 |
| **`claude/issue-371-20260306-0748`** | a0da7cc1 | **diverged, ahead 1 / behind 122** | 1 | **可捡：Docker 缺 headless shell** |
| `codex/fix-issue-with-ai-goofish-monitor` | 63475175 | behind 79 | — | 祖先 |
| `codex/github-mention` | ce5c8834 | behind 119 | — | 祖先 |
| `codex/github-mention-docker-browsertype.launch-executa` | bca233e4 | behind 121 | — | 祖先（master 曾合并，revert 分支未合并） |
| **`codex/github-mention-harkmq`** | 57d470dc | **diverged, ahead 1 / behind 118** | 2 | **可捡：区域筛选未生效** |
| **`revert-373-...`** | a3494204 | **diverged, ahead 1 / behind 120** | 1 | 回滚，说明 373 的方案被否 |
| `master` 之外的 `claude/*` 共 20 个 | — | — | — | 全部 behind |

`ahead_by` 全为 0 的那批，说明 master 里已经包含了它们的改动。`claude/*` 是 claude-code-action 机器人在 issue 里自动开的修复分支，合进 master 后分支没删，就留下了 20 条历史。

## 三个 diverged 分支的具体内容

### 1. `claude/issue-371-20260306-0748`：Docker 镜像少装 chromium-headless-shell

```
a0da7cc1 fix: install chromium-headless-shell in Docker image
Dockerfile  +2 -2
```

改动就一行：`RUN playwright install chromium` → `RUN playwright install chromium chromium-headless-shell`。

对照 master 现状（`Dockerfile:41`）已经是 `playwright install --with-deps --no-shell chromium`——用了 `--no-shell`，明确**不装** headless shell。也就是说 master 走了相反的路：既然只用有头 Chromium（`src/scraper.py:87-97` 里 Docker 下强制 `channel="chromium"`），就不需要 headless shell，省镜像体积。

**结论**：这条分支不是"待合并的修复"，是被 `--no-shell` 方案取代的旧思路。不要捡。

### 2. `codex/github-mention-harkmq`：区域筛选形同虚设

```
57d470dc fix(region): enforce area filtering and support multi-region input
src/scraper.py                              +65 -2
tests/unit/test_scraper_region_filter.py    +13 -0  (新增)
```

这是唯一一条"内容有价值"的分支。它指出 master 的区域筛选**只做 UI 点击，不做结果侧校验**——点了"南京"，返回的商品可能仍然来自全国。

master 现状能验证这个判断：`src/scraper.py:836-936` 那一大段区域选择逻辑，靠 CSS Module 前缀匹配点省份/城市/区，再用 `REGION_SUBMIT_TEXT = re.compile(r"查看(?:\d+|999\+)件宝贝")`（`src/scraper.py:107-113`）确认按钮生效；但抓回来的记录里没有任何"实际地区 vs 期望地区"的比对。`grep -n "_item_matches_region_filter\|_parse_region_filters" src/scraper.py` 在 master 上零命中。

分支补了三块：

| 改动 | 位置（分支内） | 作用 |
|---|---|---|
| `_normalize_region_keyword` / `_parse_region_filters` | `src/scraper.py:89-113` | 支持 `江苏/南京, 上海, 杭州` 逗号+斜杠混写，取最细粒度（区 > 市 > 省）做关键词 |
| `_item_matches_region_filter` | `src/scraper.py:114-124` | 双向子串匹配 `keyword in area or area in keyword`，空 area 直接判不匹配 |
| 抓取循环里过滤 | `src/scraper.py:966-971` | 对 `item_data.get("发货地区","")` 判不中就 `continue`，**在详情页请求之前**就跳过 |

关键在于过滤点放在详情抓取之前——`src/parsers.py:53` 已经把 `main_data["area"]` 落成 `"发货地区"` 字段，所以搜索列表阶段就能拿到地区，不用为不合规商品多开一次详情页。这个设计是对的。

`tests/unit/test_scraper_region_filter.py` 只测 CSS hash 与按钮文案正则，**没测** `_item_matches_region_filter`。所以这个 65 行的核心逻辑进分支时是零测试覆盖的。捡的时候要自己补。

**结论**：值得读 diff，不值得直接 merge（behind 118，`src/scraper.py` 从 1344 行变成别的样子，冲突面积不可控）。正确做法是照抄这 40 行函数 + 在 `src/scraper.py:1010` 的 `for i, item_data in enumerate(basic_items, 1):` 之后插过滤。

### 3. `revert-373-...`：一次失败方案的墓碑

```
a3494204 Revert "fix(docker): 修复容器内 Playwright 浏览器路径权限不一致导致启动失败"
Dockerfile  +6 -4
```

把 `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` 改回 `/root/.cache/ms-playwright`，并从 builder 阶段 `COPY --from=builder /root/.cache/ms-playwright ...`。

master 现状（`Dockerfile`）用的是 `/ms-playwright` + `RUN chown -R appuser:appuser /app /ms-playwright` 的思路，即"统一路径 + 改属主"，而不是回滚版"用 root 缓存目录 + COPY"。两条路都能解决权限问题，master 选了前者。

**结论**：这条分支记录了"为什么最终不用 root 缓存目录"，是理解 Dockerfile 演化的注脚，代码本身不要。

## 读代码建议

| 目的 | 看哪里 |
|---|---|
| 读懂整体架构 | 只看 `master`，配合 `02-architecture.md` |
| 理解反爬演化 | `master` + `claude/issue-200`（最老，能看出最初版本） |
| 找未修的 bug | `codex/github-mention-harkmq` 的 region 校验 |
| 理解 Docker 踩坑史 | `revert-373-...` + `claude/issue-371` 两个 Dockerfile 版本对照 |
| 一律忽略 | 20 个 `claude/issue-*`（除 371）、`doc`、`dev` |

## 分支风险

1. **`claude/*` 分支不会被清理**：20 个分支全是机器人产物，仓库 owner 没做 post-merge 删除。clone 全仓会多拉一堆无用的 tree。
2. **`dev` 与 master 反直觉**：多数项目 dev 领先 master，这里是 master 领先 dev 1 个 commit。任何"去 dev 上看看最新代码"的直觉都会拿到旧代码。
3. **shallow clone 陷阱**：本地 `git clone --depth` 后 `.git/shallow` 存在，`git rev-list --max-parents=0` 会把每个分支的头当根提交，看起来"没有 merge base"。判断分支关系必须走 GitHub compare API，不能只看本地 `git merge-base`。

## 一句话记住

28 个分支里 24 个是 master 的祖先、1 个是回滚墓碑、2 个各改 1–2 个文件；读代码只 checkout `master`，捡漏只看 `codex/github-mention-harkmq` 的区域校验 diff。
