# 03 代码走读：从入口到核心

> 这篇回答：先读什么、主流程怎么走、加功能改哪里。

## 仓库地图

```text
jimao-3a-src/
├── index.html   # 1,425,707 B；CSS 8–347；body 348–358；JS 359–6211
└── README.md    # 运行方式、操作、技术栈
```

只有一个源文件，所以“读文件”变成“读行段”。下表的行号都相对 `index.html`。

## 构建/运行入口

没有构建。浏览器直接解析 HTML：

- `<style>` 在 `index.html:8-347`，定义 HUD、菜单、字幕、设置面板。
- `<body>` 在 `index.html:348-358`，只有 `#app`、`#fatal` 等几个容器。
- `<script>` 从 `index.html:359` 开始；Three.js 模块从 `var lt={}`（`index.html:360`）到 `var oi=`（`index.html:4191`）。
- 游戏入口 `QC` 在 `index.html:6202`；它读 URL 参数、设置画质、按模块注册表启动。

运行要求：支持 WebGL2 的浏览器。低配用 `?q=low`；基准测试用 `?bench=1`（或 `#bench`）；控制台 `window.__stats()` 看统计（`index.html:6202`）。

## 主流程走读

### 第 1 步：启动与模块装配（`index.html:6202`）

`QC` 先解析 `?q`、`?seed`、`?autostart`、`?noaudio`、`?bench=1`（以及调试用的 `?cam`、`?fov`、`?shot`、`?show`）等参数；材质/关卡模块再读 `?tex`、`?wet`、`?eseed` 等模块参数。然后按 `gM` 注册表顺序调用各模块。每完成一个模块，`Nr()` 更新加载条；任何一步抛错都会写入 `window.__errors` 并显示 `#fatal`。

### 第 2 步：渲染器与后处理（`index.html:4744`、`index.html:4743`）

`Hg` 创建 `WebGLRenderer`（`antialias:false`、`powerPreference:"high-performance"`、`shadowMap` 默认 2048、`autoClear:false`、`info.autoReset:false`），再创建 scene/camera/光照，最后调用 `jy` 建立后处理链。`jy` 的 `a()` 工厂把每个 pass 编译成 `ShaderMaterial`；如果编译失败，`Hg` 的 `try/catch` 会回退到 forward 渲染。

### 第 3 步：材质烘焙（`index.html:5453`）

`Gg` 是“贴图工厂”：

1. 遍历 `c3` 的 29 个 texture set（`index.html:5294`）。
2. 为每个 set 选尺寸：`m()` 取 `size * quality.tex`，基础上限 1024；`hero` 在 `tex>=2048` 时才允许 2048。
3. 用 `e3`（公共 GLSL，`index.html:4744`）+ `Tn[fn]`（表面函数，`index.html:4833-5280`）拼出 fragment shader。
4. 渲染到 3 个 MRT：albedo、ORM、height；再用 `i3`（`index.html:5280`）从高度生成 normal。
5. 缓存进 `p` Map；`prewarm()` 可提前生成，`stats()` 返回 `textureMB/genMs`。

### 第 4 步：关卡与导航（`index.html:5453`）

`C1` 用 `ob` 的 `box/slab/cyl/tube/rod/ibeam/quad/decal/label/col/place/stairs/catwalk/stack` 组装三个区域（yard/shed/quay），放置 3 个中继、42 个出生点、55 个掩体点、12 个电影机位。`d3` 同时收集 AABB 碰撞盒，并生成 `Ls=.5` 的导航网格（约 142×124 格）。

### 第 5 步：地面与背景（`index.html:5474`、`index.html:5825`）

`Rb` 生成水洼/湿掩码，`Cb` 生成细节 albedo+normal，`Pb` 用 2D canvas 画车道线、中文路面字和轮胎印；`O1` 把它们组装成 apron/sea/skirt/rain/splash，并加平面反射 `zb`（`index.html:5661`）。

### 第 6 步：玩家与武器（`index.html:5939`、`index.html:6065`）

`x_` 每帧读输入，调用 `d3.moveCapsule` 做胶囊移动；`Mt` 里是 walk 3.8 / sprint 6.4 / gravity 21 / jumpApex 1 / coyote .12 / jumpBuffer .13 / radius .32 / height 1.8。`dm` 负责 PAC9 viewmodel、弹匣/枪机动画、换弹关键帧、后坐力、枪口焰和抛壳；`zv` 负责射线命中与伤害结算。

### 第 7 步：敌人（`index.html:6065`）

`Em` 创建飞鸥与猎犬的对象池（10 + 8），每 `.11–.19s` 做一次感知，按 `patrol → investigate → search → engage` 状态机行动；`Ui` 里的 token 机制限制同时进攻的敌人数（普通 2、拥挤 3，间隔 1.25s）。飞鸥远程发射弹丸，猎犬用四足 IK + `nav.findPath` 接近并突进。

### 第 8 步：HUD 与游戏状态（`index.html:6087`、`index.html:6202`）

`hM` 更新血量、弹药、任务目标、准星、提示和字幕；`mM` 管理 `title → intro → playing → paused → dead → complete`，包括三处中继、波次、撤离和评分。

## 先读的 10 个入口

| 顺序 | 行段 | 为什么读 |
|---|---|---|
| 1 | `index.html:6202` | `QC` + `mM`，先看游戏怎么起、怎么循环 |
| 2 | `index.html:4744` | `Hg`，渲染器与动态分辨率 |
| 3 | `index.html:4743` | `jy`，后处理链的全貌 |
| 4 | `index.html:5453` | `Gg`，贴图工厂的核心 |
| 5 | `index.html:5294` | `c3`/`l1`，29 个 texture set 与 48 个材质预设 |
| 6 | `index.html:4833-5280` | `Tn`，27 个表面 shader |
| 7 | `index.html:5453` | `C1`/`ob`/`d3`，关卡、碰撞、导航 |
| 8 | `index.html:5939` | `x_`/`Mt`/`zv`，玩家与战斗 |
| 9 | `index.html:6065` | `Em`/`Ui`/`dm`，敌人与武器 |
| 10 | `index.html:6087` | `hM`，HUD 与 UI 状态 |

## 关键类型/函数

| 名称 | 作用 | 证据 |
|---|---|---|
| `QC` | 启动器：参数、画质、模块装配 | `index.html:6202` |
| `Hg` | 渲染器：WebGLRenderer、阴影、后处理、resize | `index.html:4744` |
| `jy` | 后处理：15 种 pass / 约 26 次全屏绘制 | `index.html:4743` |
| `Gg` | 材质工厂：29 set × 3 MRT + normal | `index.html:5453` |
| `e3` | GLSL 公共库：hash/noise/fbm/voronoi/rust/paint | `index.html:4744` |
| `Tn` | 27 个 `surf(uv)` 表面函数 | `index.html:4833-5280` |
| `C1` | 关卡 builder：道具、灯光、出生点、掩体 | `index.html:5453` |
| `d3` | AABB 物理 + `moveCapsule` + 网格 A* | `index.html:5453` |
| `x_` | 玩家控制器 | `index.html:5939` |
| `Em` | 敌人管理器与状态机 | `index.html:6065` |
| `mM` | 游戏状态机/波次/结算 | `index.html:6202` |

## 加一个功能要改哪里

- **加武器**：在 `mi`（`index.html:5939`）加武器参数，在 `dm`（`index.html:6065`）加 viewmodel/动画分支，在 `zv`（`index.html:5939`）接触发与伤害，在 `hM`（`index.html:6087`）加弹药 UI。
- **加敌人类型**：在 `Ui`（`index.html:6065`）加常量与池大小，在 `Em` 里加状态机分支，复用 `Q_`/`iM` 的几何/骨架工厂；导航直接复用 `nav.findPath`。
- **加材质**：在 `Tn`（`index.html:4833-5280`）写 `surf()`，在 `c3`（`index.html:5294`）注册 `{fn,size,tile,bump}`，再在 `l1` 加预设名；不需要改 `Gg`。
- **加关卡**：在 `C1`/`ob`（`index.html:5453`）加区域与道具，在 `Gi` 加原型；碰撞盒和导航网格会随 `col/place` 自动收集。

## 测试地图

没有单元测试、没有 lint、没有 CI。可用的自检只有：

- `?bench=1`（或 `#bench`）：采样 30 秒，输出 avg/p99/median、GPU、buffer、quality、draw calls、tris（`index.html:6202`）。
- `window.__stats()`：运行时统计（`index.html:6202`）。
- `window.__errors` / `#fatal`：启动与 shader 编译错误（`index.html:6202`）。
- `Hg` 的后处理编译失败回退：`index.html:4744`。

这意味着任何改动都只能靠“打开浏览器 + 看控制台 + 跑 bench”验证；没有回归保护。

**一句话记住：** 读这个项目，先读 `QC` 的启动顺序，再读 `Gg` 的贴图工厂，最后按 `C1 → x_ → Em → mM` 走一遍游戏循环。
