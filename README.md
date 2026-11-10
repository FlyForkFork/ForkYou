# ForkYou

> 把我感兴趣的开源项目 fork 过来，用一套可复现的流程拆开看：它解决什么问题、怎么设计、代码怎么读、能借鉴什么。

ForkYou 是一个**分析内容仓库**，不是源码仓库。每个 fork 的源码克隆放在工作区根目录，与 `ForkYou` 同级：

```text
<workspace>/
  ForkYou/          # 本仓库：分析文档、guide、规则、脚本
  <fork-a>/         # 源码克隆（所有分支）
  <fork-b>/         # 下一个源码克隆
  _cache/           # 预览、任务单、临时文件（不进 Git）
```

## 项目索引

<!-- FORKYOU:INDEX:START -->
已分析 **7** 个项目。最后更新：2026-11-10 14:28:07。

### 01-systems · 系统 / 桌面 / 跨设备

| 项目 | 一句话 | 上游 | 应用地址 | Star | 深度 | 更新 | 分析 |
|---|---|---|---|---|---|---|---|
| [HGhub](01-systems/HGhub/README.md) | YellowFruit third-party client | [Minireel/HGhub](https://github.com/Minireel/HGhub) | [打开](https://github.com/Minireel/HGhub/releases) | [![GitHub stars](https://img.shields.io/github/stars/Minireel/HGhub?style=flat-square&label=%E2%AD%90)](https://github.com/Minireel/HGhub/stargazers) | L2 | 2026-11-10 | [Wiki](01-systems/HGhub/README.md) |
| [mac-everything](01-systems/mac-everything/README.md) | Everything 的 macOS 答案：菜单栏里毫秒级搜全盘文件名。 | [YuSec2021/mac-everything](https://github.com/YuSec2021/mac-everything) | [打开](https://github.com/YuSec2021/mac-everything/releases) | [![GitHub stars](https://img.shields.io/github/stars/YuSec2021/mac-everything?style=flat-square&label=%E2%AD%90)](https://github.com/YuSec2021/mac-everything/stargazers) | L2 | 2026-11-10 | [Wiki](01-systems/mac-everything/README.md) · [Guide](https://flyforkfork.github.io/ForkYou/01-systems/mac-everything/guide.html) |
| [oink](01-systems/oink/README.md) | 把多台 Mac/PC 变成一套键鼠、剪贴板、拖拽与音频的 P2P 软件 KVM，纯状态机路由 + 单线程 QUIC 网络 + 线程所有权表。 | [oinkvm/oink](https://github.com/oinkvm/oink) | [打开](https://github.com/oinkvm/oink/releases) | [![GitHub stars](https://img.shields.io/github/stars/oinkvm/oink?style=flat-square&label=%E2%AD%90)](https://github.com/oinkvm/oink/stargazers) | L2 | 2026-11-10 | [Wiki](01-systems/oink/README.md) · [Guide](https://flyforkfork.github.io/ForkYou/01-systems/oink/guide.html) |

### 02-ai-cv · AI / 计算机视觉

| 项目 | 一句话 | 上游 | 应用地址 | Star | 深度 | 更新 | 分析 |
|---|---|---|---|---|---|---|---|
| [ai-goofish-monitor](02-ai-cv/ai-goofish-monitor/README.md) | 基于 Playwright 和AI实现的闲鱼多任务实时/定时监控与智能分析系统，配备了功能完善的后台管理UI。帮助用户从闲鱼海量商品中，找到心仪产品。 | [Usagi-org/ai-goofish-monitor](https://github.com/Usagi-org/ai-goofish-monitor) | — | [![GitHub stars](https://img.shields.io/github/stars/Usagi-org/ai-goofish-monitor?style=flat-square&label=%E2%AD%90)](https://github.com/Usagi-org/ai-goofish-monitor/stargazers) | L2 | 2026-11-10 | [Wiki](02-ai-cv/ai-goofish-monitor/README.md) |

### 03-infra · 基础设施 / 运维

| 项目 | 一句话 | 上游 | 应用地址 | Star | 深度 | 更新 | 分析 |
|---|---|---|---|---|---|---|---|
| [WechatOnCloud](03-infra/WechatOnCloud/README.md) | 在 NAS / 服务器上跑「服务端微信」，多端浏览器共享同一会话。 | [Gloridust/WechatOnCloud](https://github.com/Gloridust/WechatOnCloud) | [打开](https://github.com/Gloridust/WechatOnCloud#readme) | [![GitHub stars](https://img.shields.io/github/stars/Gloridust/WechatOnCloud?style=flat-square&label=%E2%AD%90)](https://github.com/Gloridust/WechatOnCloud/stargazers) | L2 | 2026-11-10 | [Wiki](03-infra/WechatOnCloud/README.md) · [Guide](https://flyforkfork.github.io/ForkYou/03-infra/WechatOnCloud/guide.html) |

### 06-web · Web / 前端

| 项目 | 一句话 | 上游 | 应用地址 | Star | 深度 | 更新 | 分析 |
|---|---|---|---|---|---|---|---|
| [ultime-space-core](06-web/ultime-space-core/README.md) | 把一组 seed 参数编译成 274 个 token 的设计系统内核。 | [ultime-space/core](https://github.com/ultime-space/core) | [打开](https://github.com/ultime-space/core) | [![GitHub stars](https://img.shields.io/github/stars/ultime-space/core?style=flat-square&label=%E2%AD%90)](https://github.com/ultime-space/core/stargazers) | L2 | 2026-11-10 | [Wiki](06-web/ultime-space-core/README.md) · [Guide](https://flyforkfork.github.io/ForkYou/06-web/ultime-space-core/guide.html) |
| [ultime-space-skills](06-web/ultime-space-skills/README.md) | 把代码规范、文档治理、设计知识做成三个可安装、可独立发版的 AI skill 包。 | [ultime-space/skills](https://github.com/ultime-space/skills) | [打开](https://github.com/ultime-space/skills) | [![GitHub stars](https://img.shields.io/github/stars/ultime-space/skills?style=flat-square&label=%E2%AD%90)](https://github.com/ultime-space/skills/stargazers) | L2 | 2026-11-10 | [Wiki](06-web/ultime-space-skills/README.md) · [Guide](https://flyforkfork.github.io/ForkYou/06-web/ultime-space-skills/guide.html) |

<!-- FORKYOU:INDEX:END -->

## 怎么用

```bash
# 1. 检查环境
node ForkYou/_forkyou/scripts/forkyou.mjs doctor

# 2. 发现并准备所有新 fork
node ForkYou/_forkyou/scripts/forkyou.mjs sync

# 3. 只处理一个 / 多个新 fork
node ForkYou/_forkyou/scripts/forkyou.mjs sync --only my-fork-a,my-fork-b

# 4. 强制分析指定项目（不论新旧）
node ForkYou/_forkyou/scripts/forkyou.mjs analyze my-fork

# 5. 上游有更新时刷新
node ForkYou/_forkyou/scripts/forkyou.mjs refresh my-fork

# 6. 全量重建
node ForkYou/_forkyou/scripts/forkyou.mjs rebuild --all

# 7. 发布到 GitHub
node ForkYou/_forkyou/scripts/forkyou.mjs publish --project my-fork
```

Agent 的完整工作流在 [`_forkyou/SKILL.md`](_forkyou/SKILL.md)，分析规则在 [`_forkyou/RULES.md`](_forkyou/RULES.md)。

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

每个项目文件夹最少包含：

```text
<category>/<repo>/
  README.md              # 项目索引、应用地址、阅读顺序
  meta.json              # 机器可读元数据（含 analysis 决策）
  08-takeaways.md        # 可迁移想法、面试卡片——必须能吸收的内容
```

其余文档按项目规模由 Agent 判断，不强制齐全：

- `lite`（skill/模板/纯文档项目，默认）：只写上面三个，必要时加 `01-positioning.md`。
- `default`（正经开发项目，默认）：加 `01`/`02`/`03`/`07` 中适用的文档。
- `deep`（核心机制值得深挖）：再加 `04-deep-dive-*`，按需写 `05`/`06`/`09`。

`guide.data.json` / `guide.html` 可选，`lite` 项目默认不生成。完整判定规则见 [`_forkyou/RULES.md` §2–3](_forkyou/RULES.md)。

## 规则版本

`_forkyou/VERSION` 当前为 `1.1.0`。规则、skill、脚本、模板都在 [`_forkyou/`](_forkyou/)，可脱敏复制到其他机器。
