# ForkYou

> 把我感兴趣的开源项目 fork 过来，用一套可复现的流程拆开看：它解决什么问题、怎么设计、代码怎么读、能偷什么。

ForkYou 是一个**分析内容仓库**，不是源码仓库。每个 fork 的源码克隆放在工作区根目录，与 `ForkYou` 同级：

```text
<workspace>/
  ForkYou/          # 本仓库：分析文档、guide、规则、脚本
  oink/             # 源码克隆（所有分支）
  WechatOnCloud/    # 下一个源码克隆
  _cache/           # 预览、任务单、临时文件（不进 Git）
```

## 怎么用

```bash
# 1. 检查环境
node ForkYou/_forkyou/scripts/forkyou.mjs doctor

# 2. 发现并准备所有新 fork
node ForkYou/_forkyou/scripts/forkyou.mjs sync

# 3. 只处理一个 / 多个新 fork
node ForkYou/_forkyou/scripts/forkyou.mjs sync --only oink,WechatOnCloud

# 4. 强制分析指定项目（不论新旧）
node ForkYou/_forkyou/scripts/forkyou.mjs analyze oink

# 5. 上游有更新时刷新
node ForkYou/_forkyou/scripts/forkyou.mjs refresh oink

# 6. 全量重建
node ForkYou/_forkyou/scripts/forkyou.mjs rebuild --all

# 7. 发布到 GitHub
node ForkYou/_forkyou/scripts/forkyou.mjs publish --project oink

# 8. 首次启用 GitHub Pages
node ForkYou/_forkyou/scripts/forkyou.mjs pages --enable
```

Agent 的完整工作流在 [`_forkyou/SKILL.md`](_forkyou/SKILL.md)，分析规则在 [`_forkyou/RULES.md`](_forkyou/RULES.md)。

## 项目索引

<!-- FORKYOU:INDEX:START -->
还没有分析结果。

运行 `node ForkYou/_forkyou/scripts/forkyou.mjs sync` 开始。
<!-- FORKYOU:INDEX:END -->

## 目录约定

| 目录 | 内容 |
|---|---|
| `01-systems/` | 操作系统、驱动、输入、桌面、文件、跨设备 |
| `02-ai-cv/` | AI、机器学习、计算机视觉、模型推理 |
| `03-infra/` | 容器、K8s、网络、代理、可观测性、运维 |
| `04-data/` | 数据库、存储、流处理、分析 |
| `05-devtools/` | 编译器、调试器、CLI、编辑器、构建工具 |
| `06-web/` | 浏览器、前端框架、HTTP、Web 平台 |
| `07-other/` | 暂时归不进去的 |

每个项目文件夹固定包含：

```text
<category>/<repo>/
  README.md              # 项目索引、应用地址、阅读顺序
  meta.json              # 机器可读元数据
  01-positioning.md      # 它是什么、为谁解决什么痛点、竞品对比
  02-architecture.md     # 架构、模块、数据流、设计取舍
  03-code-tour.md        # 代码地图、先读哪些文件、关键抽象
  04-deep-dive-*.md      # 算法/性能/协议/并发等深挖（至少 2 篇）
  05-performance.md      # 性能敏感路径、复杂度、基准、优化
  06-branches.md         # 分支差异、关键 commit、该读哪个分支
  07-contribute.md       # 本地跑起来、测试、CI、提 PR、好上手的 issue
  08-takeaways.md        # 可迁移的架构/算法想法、面试吹B卡片
  09-ops.md              # 部署、配置、故障模式、资源需求
  guide.data.json        # guide 的结构化内容
  guide.html             # 单文件可交互快速上手
```

## 规则版本

`_forkyou/VERSION` 当前为 `1.0.0`。规则、skill、脚本、模板都在 [`_forkyou/`](_forkyou/)，可脱敏复制到其他机器。
