# ForkYou Skill

版本：1.1.0
触发词：`分析新 fork`、`分析 <repo>`、`刷新 <repo>`、`重建全部`、`ForkYou sync`。

这个 skill 给任何 Agent 用。它不绑定某个模型、IDE 或云服务。脚本只负责机械工作；分析由当前 Agent 完成。

## 0. 先读

1. `_forkyou/RULES.md`：分析结构和写作规则。
2. `_forkyou/config.json`：组织、分类、长度、缓存路径。
3. `_forkyou/state/manifest.json`：已分析项目状态。
4. 工作区根 `.env`：`FORKYOU_GITHUB_TOKEN`（可选，用于 GitHub API 元数据；git clone/push 用 SSH）。

目录约定：

```text
<workspace>/
  ForkYou/                  # 内容仓库（本仓库）
  <repo>/                   # 每个 fork 的源码克隆，所有分支
  _cache/
    work/<id>/work.json     # 任务单（含分支 SHA/diffstat）
    preview/<repo>/         # dry-run 输出
    tmp/                    # 临时文件
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
node ForkYou/_forkyou/scripts/forkyou.mjs sync --only my-fork-a,my-fork-b

# 只看计划，不落盘
node ForkYou/_forkyou/scripts/forkyou.mjs sync --dry-run
```

`sync` 会：

1. 调 GitHub API 列出 `FlyForkFork` 下所有 fork。
2. 跳过已分析项目。
3. 把每个 fork 的**上游仓库**克隆到工作区根目录的 `<repo>`。
   - 默认 `--depth 1 --no-single-branch`：所有分支的最新 commit。
   - `--full`：完整历史。
   - 已存在则 `git fetch --all --prune`，不重复下载。
4. 记录每个分支的最新 SHA、文件数和与默认分支的 diffstat；**不创建分支工作树，不保留代码快照**。
   - 读其他分支文件用 `git -C <clone> show origin/<branch>:<path>`。
5. 生成任务单 `_cache/work/<id>/work.json`；分支信息写在任务单的 `branches` 字段。
6. 更新 manifest：`status=prepared`。

## 3. 分析一个项目

```bash
node ForkYou/_forkyou/scripts/forkyou.mjs analyze my-fork
```

加 `--dry-run` 时输出到 `_cache/preview/<repo>`，不更新 manifest、不发布。用于先看效果。

`analyze` 会准备分支信息、任务单和目标目录；文档骨架由 Agent 按 `templates/` 创建。然后 Agent 按顺序填：

1. 读 `work.json`，确认 `clone_dir`、`output_dir`、`branches`、`depth`、`length`。
2. 从 `branches` 知道默认分支和各分支 SHA/diffstat。
3. **先定输出规模（动笔前）**：读 `README*`、license、构建文件，用 `branches[].files`、`git ls-files`、语言构成判断项目形态，按 `RULES.md` §2 选 `lite` / `default` / `deep`；把档位和理由写进 `meta.json.analysis`，把要写的文档写进 `meta.json.docs`（至少 `README.md`、`08-takeaways.md`）。
4. 按档位读源码：
   - `README*`、license、构建文件。
   - 入口文件、核心 crate/package。
   - 测试、CI、release workflow。
5. 外部研究（≤5 来源）。
6. 按分析计划写文档：必须写 `README.md`、`08-takeaways.md`、`meta.json`；其余只写 `meta.docs` 里列出的文档，不硬凑。写完把实际文件同步进 `meta.docs`。
   - 写 `08-takeaways.md` 前必须做双 Agent 模拟面试：
     - 用 subagent 启一个“面试官”，把这个项目当成自己的设计实现，按档位出 `lite` 3–5 / `default` 6–8 / `deep` 8–12 题；
     - 用另一个 subagent 当“面试者”，第一人称逐题回答，只引用分析里的 `file:line` 证据，无证据写“待查实”；
     - 主 Agent 把问答整理成面试卡（问题、30 秒答案、追问）。
7. 可选 guide：只有判定值得做时才写 `guide.data.json`，再运行 `render-guide`；`lite` 项目默认跳过。
8. 运行 `validate`（结构检查；不需要每次启动 headless Chrome 截图）。
9. 运行 `publish`。

`meta.json.analysis` 示例：

```json
{
  "profile": "lite",
  "reason": "skill 规则集合，无可运行服务，192 个文件绝大多数是 Markdown",
  "skipped": [
    {"doc": "05-performance.md", "reason": "无运行时性能路径"},
    {"doc": "09-ops.md", "reason": "无部署形态"}
  ]
}
```

> guide.html 只在用户明确报告显示问题时再单独调试；正常分析流程不跑浏览器截图验证。

输出规模默认值（先按 `RULES.md` §2 判定，再听用户指令）：

- skill 包、提示词/消息模板、纯文档仓库 → `--length lite`。
- 正经开发项目 → `--length default`。
- 有值得深挖的机制或用户说“越详细越好” → `--length deep`。
- 用户说“写 8000 字” → `--length 8000`（允许 ±20%）。

## 4. 刷新

```bash
node ForkYou/_forkyou/scripts/forkyou.mjs refresh my-fork
```

比较 `meta.json.analyzed_commit` 和上游默认分支最新 commit：

- 相同：跳过。
- 不同：重新收集分支信息，生成新任务单，Agent 重新分析。
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
node ForkYou/_forkyou/scripts/forkyou.mjs publish --project my-fork

# 发布所有已分析项目
node ForkYou/_forkyou/scripts/forkyou.mjs publish --all

# 只看会提交什么
node ForkYou/_forkyou/scripts/forkyou.mjs publish --project my-fork --dry-run
```

发布前自动：

- 校验项目目录。
- 更新 manifest 状态、commit、时间。
- 重新生成根 `README.md` 索引。
- `git add` 本次文件，commit，push。

## 7. 失败处理

- 单个项目失败：manifest 标 `failed`，写 `error`，继续下一个。不要保留该项目的代码快照；分支 SHA 已在任务单里。
- 不删除旧文档。
- 下次 `sync` 会重试 `failed`。
- 网络失败：保留 clone，下次 `git fetch` 增量更新。

## 8. 任务单格式

`_cache/work/<id>/work.json`：

```json
{
  "version": 1,
  "created_at": "...",
  "preview": false,
  "project": {
    "id": "github:example-org/example-repo",
    "name": "example-repo",
    "provider": "github",
    "upstream": "example-org/example-repo",
    "fork": "example-org/example-repo",
    "category": "01-systems",
    "path": "01-systems/example-repo",
    "depth": "L2",
    "length": "default"
  },
  "clone_dir": "<workspace>/example-repo",
  "output_dir": "<workspace>/ForkYou/01-systems/example-repo",
  "branches": ["..."],
  "meta_seed": {"..." : "..."},
  "depth": "L2",
  "length": "default"
}
```

## 9. 分支数据

`work.json` 的 `branches` 数组包含每个分支的最新提交，不保存分支工作树：

```json
[
  { "name": "main", "sha": "...", "files": 1000, "default": true },
  { "name": "feature-x", "sha": "...", "files": 1002,
    "ahead": 1, "behind": 0, "diffstat": "2 files changed, ...",
    "changed_files_total": 2, "changed_files": ["前 200 条"] }
]
```

Agent 用 `git -C <clone> diff origin/main..origin/<branch>` 看细节，用 `git -C <clone> show origin/<branch>:<path>` 读其他分支文件。

## 10. 迁移到其他机器

1. 复制 `ForkYou/_forkyou/` 到新机器。
2. 复制或重建 `ForkYou` 仓库（git clone）。
3. 在新机器根目录放 `.env`（只有 token）。
4. 配好 SSH key。
5. 运行 `doctor`。
6. 把 `_forkyou/AGENTS.md.example` 复制成工作区根 `AGENTS.md`。

脚本不含机器路径硬编码：路径从 `_forkyou` 位置推导。
