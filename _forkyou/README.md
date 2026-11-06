# `_forkyou` 特殊文件夹

这个文件夹放 ForkYou 的**规则、skill、脚本、模板、状态**。它跟具体机器无关，可以脱敏复制到其他工作区。

## 文件

| 文件 | 作用 |
|---|---|
| `VERSION` | 规则版本 |
| `RULES.md` | 分析结构、写作规则、质量检查 |
| `SKILL.md` | Agent 执行流程、命令、失败处理 |
| `config.json` | 组织、分类、默认深度/长度、发布配置 |
| `AGENTS.md.example` | 工作区根 `AGENTS.md` 的模板 |
| `schema.md` | `meta.json` / `manifest.json` / `guide.data.json` 字段说明 |
| `templates/` | 项目 README、文档骨架、guide 模板 |
| `scripts/forkyou.mjs` | CLI 主入口 |
| `scripts/lib/` | git、GitHub、manifest、render 工具 |
| `state/manifest.json` | 所有项目的状态机 |

## 最短迁移

```bash
# 1. 新机器上克隆内容仓库
git clone git@github.com:FlyForkFork/ForkYou.git

# 2. 复制本文件夹（如果新仓库里还没有）
# 3. 根目录放 .env，只写 token 本身（也支持 FORKYOU_GITHUB_TOKEN=...）
# 4. 配好 SSH key
# 5. 检查
node ForkYou/_forkyou/scripts/forkyou.mjs doctor
```

`AGENTS.md.example` 复制到工作区根，改名为 `AGENTS.md`。它只有几行，用最简单的话指向本文件夹。

## 不放在这里的东西

- 源码克隆：放工作区根，与 `ForkYou` 同级。
- 预览/任务单/临时文件：放 `_cache`，不进 Git。
- token：只放工作区根 `.env`，不进 Git。
