# ForkYou Skill

版本：1.0.0  
触发词：`分析新 fork`、`分析 oink`、`刷新 oink`、`重建全部`、`ForkYou sync`。

这个 skill 给任何 Agent 用。它不绑定某个模型、IDE 或云服务。脚本只负责机械工作；分析由当前 Agent 完成。

## 0. 先读

1. `_forkyou/RULES.md`：分析结构和写作规则。
2. `_forkyou/config.json`：组织、分类、长度、缓存路径。
3. `_forkyou/state/manifest.json`：已分析项目状态。
4. 工作区根 `.env`：`FORKYOU_GITHUB_TOKEN`（可选，用于 GitHub API 元数据；git clone/push 用 SSH）。

目录约定：

```text
D:\FlyForkFork\
  ForkYou\                  # 内容仓库（本仓库）
  <repo>\                   # 每个 fork 的源码克隆，所有分支
  _cache\
    work\<id>\work.json     # 任务单
    snapshots\<id>\<branch> # 分支工作树（只读分析用）
    preview\<repo>\         # dry-run 输出
    tmp\
```

## 1. 预检

```bash
node ForkYou/_forkyou/scripts/forkyou.mjs doctor
```

必须通过：

- Node >= 20。
- `git --version` 可用。
- `ssh -T git@github.com` 返回 `Hi <user>!`。
- `ForkYou` 是 git 仓库，remote 指向 `FlyForkFork/ForkYou`。
- `.env` 有 token（可选，但建议）。

## 2. 发现新 fork 并准备

```bash
# 所有新 fork
node ForkYou/_forkyou/scripts/forkyou.mjs sync

# 只处理指定新 fork（一个或多个）
node ForkYou/_forkyou/scripts/forkyou.mjs sync --only oink,WechatOnCloud

# 只看计划，不落盘
node ForkYou/_forkyou/scripts/forkyou.mjs sync --dry-run
```

`sync` 会：

1. 调 GitHub API 列出 `FlyForkFork` 下所有 fork。
2. 跳过已分析项目。
3. 把每个 fork 的**上游仓库**克隆到 `D:\FlyForkFork\<repo>`。
   - 默认 `--depth 1 --no-single-branch`：所有分支的最新 commit。
   - `--full`：完整历史。
   - 已存在则 `git fetch --all --prune`，不重复下载。
4. 为每个分支创建只读工作树到 `_cache/snapshots/...`。
5. 生成任务单 `_cache/work/<id>/work.json`；分支快照与 `snapshot.json` 在 `_cache/snapshots/github/<owner>/<repo>/`。
6. 更新 manifest：`status=prepared`。

## 3. 分析一个项目

```bash
node ForkYou/_forkyou/scripts/forkyou.mjs analyze oink
```

加 `--dry-run` 时输出到 `_cache/preview/oink`，不更新 manifest、不发布。用于先看效果。

`analyze` 会准备快照、任务单和目标目录；文档骨架由 Agent 按 `templates/` 创建。然后 Agent 按顺序填：

1. 读 `work.json`，确认 `output_dir`、`snapshot_dir`、`depth`、`length`。
2. 读 `snapshot.json`，知道默认分支和分支差异。
3. 读源码：
   - `README*`、license、构建文件。
   - 入口文件、核心 crate/package。
   - 测试、CI、release workflow。
4. 外部研究（≤5 来源）。
5. 写 10 篇文档（8 个主题 + 2 篇 deep-dive）。
6. 写 `guide.data.json`。
7. 运行 `render-guide` 生成 `guide.html`。
8. 运行 `validate`。
9. 运行 `publish`。

长度指令：

- 用户说“越详细越好” → `--length deep`。
- 用户说“精简版” → `--length lite`。
- 用户说“写 8000 字” → `--length 8000`。
- 默认 `default`。

## 4. 刷新

```bash
node ForkYou/_forkyou/scripts/forkyou.mjs refresh oink
```

比较 `meta.json.analyzed_commit` 和上游默认分支最新 commit：

- 相同：跳过。
- 不同：重新准备快照，生成新任务单，Agent 重新分析。
- `--dry-run`：只报告差异。

## 5. 全量重建

```bash
node ForkYou/_forkyou/scripts/forkyou.mjs rebuild --all
```

对 manifest 里所有 `status=analyzed` 的项目重新生成任务单。默认保留旧文档；加 `--force` 覆盖。

## 6. 发布

```bash
# 只发布脚手架（第一次）
node ForkYou/_forkyou/scripts/forkyou.mjs publish --scaffold

# 发布一个项目
node ForkYou/_forkyou/scripts/forkyou.mjs publish --project oink

# 发布所有已分析项目
node ForkYou/_forkyou/scripts/forkyou.mjs publish --all

# 只看会提交什么
node ForkYou/_forkyou/scripts/forkyou.mjs publish --project oink --dry-run
```

发布前自动：

- 校验项目目录。
- 更新 manifest 状态、commit、时间。
- 重新生成根 `README.md` 索引。
- `git add` 本次文件，commit，push。

## 7. 失败处理

- 单个项目失败：manifest 标 `failed`，写 `error`，继续下一个。
- 不删除旧文档。
- 下次 `sync` 会重试 `failed`。
- 网络失败：保留 clone，下次 `git fetch` 增量更新。

## 8. 任务单格式

`_cache/work/<id>/work.json`：

```json
{
  "id": "github:oinkvm/oink",
  "repo": "oink",
  "provider": "github",
  "upstream": "oinkvm/oink",
  "fork": "FlyForkFork/oink",
  "category": "01-systems",
  "depth": "L2",
  "length": "default",
  "clone_dir": "D:\\FlyForkFork\\oink",
  "snapshot": "D:\\FlyForkFork\\_cache\\snapshots\\github\\oinkvm\\oink",
  "default_branch": "main",
  "output_dir": "D:\\FlyForkFork\\ForkYou\\01-systems\\oink",
  "docs": ["01-positioning.md", "..."],
  "created_at": "..."
}
```

## 9. 分支数据

`snapshot.json` 包含：

```json
{
  "default_branch": "main",
  "branches": [
    { "name": "main", "sha": "...", "dir": "...", "files": 3944, "default": true },
    { "name": "update-feed-state", "sha": "...", "dir": "...", "files": 31,
      "ahead": 1, "behind": 0, "diffstat": "3975 files changed, ...",
      "changed_files_total": 3975, "changed_files": ["前 200 条"] }
  ]
}
```

Agent 用 `git -C <clone> diff origin/main..origin/<branch>` 看细节。

## 10. 迁移到其他机器

1. 复制 `ForkYou/_forkyou/` 到新机器。
2. 复制或重建 `ForkYou_ForkYou` 仓库（git clone）。
3. 在新机器根目录放 `.env`（只有 token）。
4. 配好 SSH key。
5. 运行 `doctor`。
6. 把 `_forkyou/AGENTS.md.example` 复制成工作区根 `AGENTS.md`。

脚本不含机器路径硬编码：路径从 `_forkyou` 位置推导。
