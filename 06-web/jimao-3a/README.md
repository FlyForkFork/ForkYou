# jimao-3a

> 一个 1.4 MB 的单文件 WebGL2 港口突袭 FPS：没有一张图片、一段音频，贴图、几何、音效全部在浏览器里用代码生成。

| 项 | 值 |
|---|---|
| 源仓库 | [FlyForkFork/jimao-3a-src](https://github.com/FlyForkFork/jimao-3a-src) |
| Fork | [FlyForkFork/jimao-3a](https://github.com/FlyForkFork/jimao-3a) |
| License | 无（GitHub 识别为 NOASSERTION） |
| 语言 | HTML + JavaScript（Three.js r185 内嵌） |
| 版本 | 无版本号，开发体验版 |
| 分析深度 | L2 / deep |
| 分析 commit | `ce22e9a592fc8c4b2960a26a32437732d92ed2dd` |
| 更新时间 | 2026-11-11 |

## 这套文档怎么读

| 文档 | 回答什么问题 | 什么时候读 |
|---|---|---|
| [01 定位](01-positioning.md) | 它是什么、和 Unity/Unreal/Godot/Three.js 示例差在哪、健康度 | 第一次接触 |
| [02 架构](02-architecture.md) | 单文件里有哪些模块、启动顺序、数据怎么流、为什么这样拆 | 想理解全局 |
| [03 代码走读](03-code-tour.md) | 先看哪些行、主流程怎么走、加功能改哪里 | 准备读代码 |
| [04 深挖：程序化资产](04-deep-dive-procedural-assets.md) | **为什么只有 1.4 MB、贴图到底从哪来** | 最关心体积 |
| [04 深挖：渲染器](04-deep-dive-renderer.md) | 26 个全屏 pass、阴影、天空、动态分辨率怎么组织 | 想做 WebGL 后处理 |
| [04 深挖：敌人 AI](04-deep-dive-enemy-ai.md) | 飞鸥/猎犬的状态机、token 协调、四足 IK | 想做有压迫感的敌人 |
| [04 深挖：物理与导航](04-deep-dive-physics-nav.md) | AABB 胶囊、网格 A*、没有物理引擎怎么跑 | 想做 FPS 移动 |
| [05 性能](05-performance.md) | 哪里最贵、纹理内存多少、怎么降档 | 做性能判断 |
| [08 收获](08-takeaways.md) | 可迁移想法、模拟面试 Q&A、不该抄的地方 | 做分享/面试 |
| [09 运维](09-ops.md) | 怎么部署、有哪些参数、黑屏/卡顿怎么查 | 要落地 |
| [Guide](https://flyforkfork.github.io/ForkYou/06-web/jimao-3a/guide.html) | 10 分钟交互图册：架构、一帧流程、代码地图、面试卡 | 想快速浏览 |

## 快速开始

没有构建步骤，也没有依赖安装：

```bash
# 直接双击，或起一个静态服务器
python -m http.server 8000
# 打开 http://localhost:8000/index.html
```

需要 WebGL2。低配设备可在 URL 后加 `?q=low`；内置性能采样用 `?bench=1`（或 `#bench`），控制台 `window.__stats()` 可看纹理与绘制统计（`index.html:6202`）。

## 体积速览

| 项 | 值 |
|---|---|
| 总大小 | 1,425,707 B（gzip 449,312 B / brotli 368,516 B） |
| Three.js r185 | 约 701,719 B（内嵌文本） |
| 游戏代码 | 约 688,251 B |
| 图片/音频文件 | 0 |
| data URI | 0 |

## 一句话记住

它把“3A 感”拆成可计算的几件事：程序化 PBR 贴图、分层后处理、有节制的敌人调度、AABB + 网格 A*，然后用一个 HTML 交付——代价是首次加载要现场生成几十 MB 纹理，而不是下载几十 MB 图片。
