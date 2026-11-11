# 04 深挖：程序化资产——为什么只有 1.4 MB，贴图从哪来

> 这篇回答：没有一张图片、一段音频，为什么还能有完整港口和 PBR 质感？体积到底省在哪、代价是什么？

## 问题

一个带港口、集装箱、机械敌人、枪械、HUD、音效的 3D FPS，常规做法是“引擎 + 资源包”：模型（glTF/FBX）、贴图（PNG/KTX2）、音频（OGG/WAV）、动画、关卡文件。轻松几百 MB 到几 GB。

这个项目总共 **1,425,707 B**（gzip 449,312 B / brotli 368,516 B），其中 Three.js 约 701,719 B、游戏代码约 688,251 B，**图片/音频文件 0 个、data URI 0 个**。它必须回答一个问题：贴图、几何、音效从哪来？

答案：**全部在运行时由代码生成**。这不是“压缩得好”，而是“根本没有可压缩的资产”。

## 朴素做法为什么不够

| 做法 | 体积 | 问题 |
|---|---|---|
| 每个材质一张 1024² PNG | 每张 1–4 MB，几十张就上百 MB | 下载、解码、显存都重；单文件交付直接失败 |
| 全部塞 data URI | 文件更大（Base64 膨胀 ~33%） | 解析阻塞、无法缓存、不可维护 |
| 只用纯色材质 | 很小 | 没有 PBR 细节，画面像灰盒 |
| 每个材质写独立 shader | 代码膨胀 | 29 个材质 × 复杂光照，shader 编译与维护成本高 |

项目选择的是第四条路的变体：**用一套可复用的 GLSL 噪声库 + 参数表，在 GPU 上批量烘焙贴图**。

## 这个项目怎么做

### 1. 一个“贴图工厂”：`Gg`

`Gg`（`index.html:5453`）不是加载贴图，而是**生产贴图**：

1. 读 `c3`（`index.html:5294`）里的 29 个 texture set。每个 set 长这样：

   ```js
   asphalt: { fn:"asphalt", size:1, tile:2, bump:1.6, hero:true }
   concrete:{ fn:"concrete", size:1, tile:3, bump:2.5 }
   polymer: { fn:"polymer", size:.25, tile:.1, bump:.4 }
   ```

   `fn` 指向 `Tn` 里的表面函数，`size` 决定分辨率，`tile` 决定世界尺度，`bump` 决定法线强度，`hero` 允许 2048。

2. 为每个 set 选尺寸：`m()` 计算 `Math.round(quality.tex * size)`，基础上限 1024；只有 `hero && tex>=2048` 时给 2048（`index.html:5453`）。这解释了为什么“超高”并不会把所有贴图都拉到 2K。
3. 用 `e3`（公共 GLSL，`index.html:4744`）+ `Tn[fn]`（表面函数，`index.html:4833-5280`）拼出 fragment shader，渲染一个全屏 quad 到 3 个 MRT：
   - `o0`：albedo（`sqrt` 近似 gamma，alpha 备用）
   - `o1`：AO / roughness / metalness
   - `o2`：height 的两个通道
4. 用 `i3`（`index.html:5280`）从 height 生成 normal map。
5. 把三张 `WebGLRenderTarget` 的 texture 缓存进 `Map`；同名材质复用，不重复烘焙。

### 2. 噪声库：`e3`

`e3` 只有 5,317 字符，但提供了后续所有材质的基础函数：

- `pcg3`：整数哈希，给每个像素稳定的随机值。
- `h3`：3D 哈希噪声。
- `gn`：梯度噪声。
- `fbm`：分形叠加，做混凝土、锈迹、木纹的大尺度起伏。
- `vor`：Voronoi，做瓷砖缝、碎石、链环。
- `scr`：划痕。
- `emit`：把 albedo/ORM/height 打包成 MRT 输出。
- `rustMask`、`paintDmg`：锈蚀与掉漆的专用 mask。

这些函数是“可复用的美术语言”：换参数就能从沥青变混凝土、从镀锌板变锈蚀钢板，而不需要新图片。

### 3. 27 个表面函数：`Tn`

`Tn`（`index.html:4833-5280`）共 30,351 字符，包含 27 个 `surf(vec2 uv)`：

```text
asphalt concrete brick epoxy paint hull galv metal brushed rust
diamond corrugated chainlink hazard gunmetal anodized polymer carbon
fabric armor wood plastic tarp cardboard rope tire glass water
```

每个函数负责“这一类表面长什么样”。例如 `asphalt` 用 Voronoi 做骨料、用 FBM 做磨损；`brick` 用砖缝与色差；`corrugated` 用正弦波纹 + 锈迹；`chainlink` 用菱形网格 + alpha cutout。它们不是照片，而是**可参数化的表面模型**。

### 4. 48 个材质预设：`l1`

`l1`（`index.html:5294`）把 texture set 组合成具体材质名，例如：

- `paint_red/blue/green/yellow/orange/white/grey/teal` 共享 `paint` set，只换 tint、roughness、wet/macro 参数。
- `steel_galv`、`steel_dark`、`steel_worn`、`steel_bare`、`steel_rust` 共享 `galv/metal/brushed/rust` set，只换颜色与粗糙度。
- `concrete_dirty`、`concrete_painted` 共享 `concrete` set，靠 `color`/`tint`/`wet` 区分。

这就是“29 个 set 撑起 48 个材质”的原因：**变化发生在参数层，不在资产层**。

### 5. 地面：CPU 掩码 + Canvas 标线

地面不是一张巨大的贴图，而是几层组合（`index.html:5474`、`index.html:5825`）：

- `Rb`：生成 1024/512 的 `Uint8Array` 水洼/湿度 mask，控制哪里反光、哪里是湿的。
- `Cb`：生成 512/256 的 detail albedo + normal，负责近处的颗粒感。
- `Pb`：用 2D canvas 在 2048/1024 上画车道线、中文路面字、轮胎印和污渍。
- `N1`：把 canvas 包成 `DataTexture`。
- `O1`：把 apron/sea/skirt/rain/splash 组装起来，并加 `zb` 平面反射（`index.html:5661`）。

这层“2D canvas 画标线”很实用：文字和箭头用系统字体画，比在 shader 里写字形简单得多，也不会增加字体文件。

### 6. 贴花与标牌：`l3`

`l3`（`index.html:5294`）用 canvas 生成 22 种贴花/标牌：`hazard_flammable`、`hazard_voltage`、`arrow`、`berth4`、`rust_run`、`bullet_metal` 等。它们是小尺寸 RGBA 纹理，贴在集装箱、墙面、地面，补足“真实港口”的叙事细节。

### 7. 几何与音频也是代码

- **几何**：`ob`（`index.html:5453`）提供 box/slab/cyl/tube/rod/ibeam/quad/decal/label/col/place/stairs/catwalk/stack；`Gi` 定义 36 种道具原型（集装箱、护栏、灯杆、货架、叉车、油桶等）。没有 `.glb`。
- **音频**：`u_`（`index.html:5939`）用 WebAudio 预渲染 PCM 缓冲，按 6 ms 时间片空闲合成枪声、脚步、环境声；没有 `.ogg/.wav`。

## 代码证据

| 结论 | 证据 |
|---|---|
| 29 个 texture set、参数化定义 | `index.html:5294` |
| 运行时 GPU 烘焙 + 3 MRT | `index.html:5453` |
| 公共噪声库 5,317 字符 | `index.html:4744` |
| 27 个表面函数、30,351 字符 | `index.html:4833-5280` |
| height → normal | `index.html:5280` |
| 地面水洼/细节/标线 | `index.html:5474`、`index.html:5825` |
| 22 种 canvas 贴花 | `index.html:5294` |
| 36 种道具原型 | `index.html:5453` |
| 音频合成 | `index.html:5939` |

## 复杂度/性能/边界

### 纹理内存估算

`Gg` 的 `b()` 每创建一张图就累加 `O*O*4*1.34` 字节（包含 mipmap 余量），每个 set 3 张（albedo/ORM/normal）。按 `c3` 的 29 个 `size` 加权估算：

| 画质 | 基础 tex | 估算显存 |
|---|---|---|
| low | 256 | ≈ 8.6 MB |
| medium | 512 | ≈ 34.4 MB |
| high | 1024 | ≈ 137.7 MB |
| ultra | 1024 + asphalt hero 2048 | ≈ 185.9 MB |

这是**推断值**：按代码的 `D*D*4*1.34 × 3 × 29` 计算，未在真实 GPU 上实测；不同驱动的 mipmap/对齐会让数字有偏差。`stats().textureMB` 可在运行时给出实际值（`index.html:5453`）。

### 启动成本

- 29 个 set × 3 个 render target，每个要跑一次全屏 fragment shader + 一次 normal pass。
- 1024² 时单张 RGBA8 约 4 MB；即使只算最终纹理，也是百 MB 级显存。
- `Gg` 提供 `prewarm()`，但默认是**按需生成**：第一次用到某个材质才烘焙，所以开场加载条不是全部成本，进游戏后仍可能卡一下。
- `update()` 在 4 秒空闲后会释放中间 render target（`h.clear()`），但最终 texture 仍保留（`index.html:5453`）。

### 质量边界

- 基础上限 1024，只有 `hero` 在 `tex>=2048` 时到 2048；所以近看集装箱焊缝、地面标线会软。
- 程序化噪声缺少真实扫描材质的“脏点分布”，容易出现重复感；项目用 `seed`、`p`、`tile`、`macro` 参数缓解，但不能完全消除。
- 没有 KTX2/Basis 压缩；RGBA8 是“能跑”的选择，不是“最优显存”的选择。

## 取舍与局限

- **省下载，换启动**：把“下载几百 MB”换成“启动时算几十秒 + 占百 MB 显存”。对单文件演示是划算的；对需要快速首屏的网站不划算。
- **省资产，换独特**：程序化材质可以很像，但不会有一张真实扫描贴图的信息密度；适合风格化/工业风，不适合面部、布料特写等。
- **省工具，换可控**：没有 Substance/Blender 的可视化编辑，调材质就是改 GLSL 参数；对程序员友好，对美术不友好。
- **省依赖，换功能**：没有纹理压缩、没有流式加载、没有资产版本管理；一旦纹理更多，`Gg` 的 Map 和启动时间会线性上涨。

## 我能偷什么

1. **“shader 库 + 参数表 + 运行时烘焙”三件套**：把材质差异收敛到 `{fn,size,tile,bump,p,seed}`，新增材质不改渲染器。
2. **MRT 打包**：albedo/ORM/height 一次画完，height 再生成 normal；比分别画三张省 draw。
3. **分辨率按 `size` 加权**：不是所有材质都值得 2K；hero 才给 2048，其余 1024/512。
4. **Canvas 画文字/标线**：路面中文、警示牌、贴花用 2D API，简单且无字体依赖。
5. **先问“这张图能不能算出来”**：对噪声、条纹、锈迹、瓷砖、链环这类图案，答案经常是能。

**一句话记住：** 1.4 MB 的秘密不是压缩，而是把“图片”换成了“生成图片的程序”——下载省了，GPU 和首次加载时间付账。
