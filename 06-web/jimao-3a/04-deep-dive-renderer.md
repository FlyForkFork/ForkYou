# 04 深挖：渲染器——26 个全屏 pass 怎么排

> 这篇回答：一个单文件 WebGL2 项目，怎样在没有引擎后处理的情况下做出 AO、体积光、Bloom、运动模糊和电影感色调？

## 问题

Three.js 默认渲染器只负责“把场景画出来”：光照、材质、阴影。要得到“港口夜雨 + 电影感”的画面，还需要：

- 环境光遮蔽（AO）
- 体积光/雾
- Bloom/光晕
- 运动模糊
- 自适应曝光
- 色调映射、调色、暗角、颗粒、锐化
- 抗锯齿

每一项都可以是一个全屏 pass；组合顺序错了会糊、会闪、会吃掉性能。

## 朴素做法为什么不够

- **只开 Three.js 默认 tone mapping**：画面平，缺少空间感；阴影硬，金属没有层次。
- **每个效果一个独立全屏 pass，直接串联**：pass 数量爆炸，带宽和 fill-rate 撑不住；移动端直接掉到 20 FPS。
- **全部塞进一个 uber shader**：编译慢、分支多、难以按画质档位关闭。
- **不做动态分辨率**：高分辨率屏上像素预算失控，后处理越全越卡。

## 这个项目怎么做

### 1. 渲染器底座：`Hg`

`Hg`（`index.html:4744`）创建 `WebGLRenderer`：

- `antialias:false`：抗锯齿交给后处理（FXAA），避免 MSAA 与全屏 pass 双重开销。
- `powerPreference:"high-performance"`：优先独显。
- `shadowMap` 默认 2048，画质高时到 4096（`Pr`，`index.html:4191`）。
- `autoClear:false`、`info.autoReset:false`：手动控制清屏与统计。
- `outputColorSpace` / tone mapping 在场景与后处理之间切换；最终 pass 做 gamma/色调。

### 2. 后处理链：`jy`

`jy`（`index.html:4743`）用 `a(name, fragmentShader, uniforms, options)` 工厂创建 15 种 pass：

| pass | 作用 | 关键参数 |
|---|---|---|
| `depthcopy` / `depthhalf` | 复制/半分辨率深度 | near .08 / far 900 |
| `ao` | 屏幕空间 AO | `AO_TAPS:12`，radius .9，intensity 1.6 |
| `blur-ao` | 双边模糊 AO | `BLUR_TOL:0.04` |
| `vol` | 体积光/雾 | `VOL_STEPS:16`，sigma .0034，maxDist 170 |
| `blur-vol` | 体积光模糊 | `BLUR_TOL:0.30` |
| `composite` | 合并颜色/AO/体积光 | half-res 重建 |
| `motion` | 运动模糊 | shutter .5 |
| `down` ×6 / `up` ×5 | Bloom 金字塔 | 6 级下采样、5 级上采样 |
| `streak` | 水平光晕 | threshold 2.2 |
| `adapt` | 自适应曝光 | min .6 / max 2，tau 1.5 |
| `dirt` | 镜头污渍 | 512×288 |
| `grade` | 调色/暗角/颗粒/锐化/FXAA | lookPower 1.18、lookSat 1.22、grain .02、sharpen .3 |
| `final` | 最终合成 | 输出到 canvas |

按代码的循环，单帧大约 **26 次全屏绘制**：depthcopy + depthhalf + AO + 2 次 blur + 体积光 + blur + composite + motion + 6 down + 5 up + streak + adapt + dirt + grade + final。这个数字会随画质档位和效果开关变化。

### 3. 阴影与天空

- `SALTLINE_SHADOW`（`index.html:4296-4349`）是自定义软阴影 shader：PCF 采样 + 可调软度，默认 10/16 taps；阴影贴图 2048，画质高到 4096。
- `SALTLINE_SKY`（`index.html:4207-4294`）是程序化天空：太阳方向、天顶/地平线颜色、雾、远景；没有 HDR 环境贴图。
- `Vy` 用 PMREM 从程序化天空生成环境贴图（`index.html:4296` 附近），给 PBR 材质提供反射。
- 平面反射 `zb`（`index.html:5661`）用于海面/湿地面，渲染一张低分辨率反射图再混合。

### 4. 动态分辨率

`Hg` 内部有 `z()`/`resize()`（`index.html:4744`）：

- 目标帧时间 **21.5 ms**（约 46 FPS）和 **17.4 ms**（约 57 FPS）两档；连续超时会降 `scale`，最低 **0.6**。
- 像素预算：low 1e6 / medium 1.5e6 / high 2.3e6 / ultra 3.7e6。
- 分辨率下降只影响 render target 与后处理，不改 CSS 尺寸，所以画面不会变形。

### 5. 失败回退

`Hg` 用 `try/catch` 包住 `jy` 的创建与首次渲染；如果后处理 shader 编译失败，会走 forward rendering（不带后处理）并记录 `window.__errors`。这是单文件项目很重要的“可运行性”设计：宁可画面差，也不能黑屏。

## 代码证据

| 结论 | 证据 |
|---|---|
| 渲染器参数与动态分辨率 | `index.html:4744` |
| 15 种后处理 pass | `index.html:4743` |
| AO 12 taps / 体积光 16 steps | `index.html:4743` |
| Bloom 6 down / 5 up | `index.html:4743` |
| 软阴影 shader | `index.html:4296-4349` |
| 程序化天空 | `index.html:4207-4294` |
| 平面反射 | `index.html:5661` |
| 画质档位（shadow/tex/volSteps/msaa） | `index.html:4191` |

## 复杂度/性能/边界

- **Fill-rate 是主成本**：26 个全屏 pass 在 1080p 上就是 26 × 2.07M 像素；4K 下是 4 倍。动态分辨率是必需项，不是优化项。
- **半分辨率**：AO、体积光、Bloom 的下采样降低了成本，但会带来边缘溢光/闪烁；`blur-ao`/`blur-vol` 的双边模糊用来遮。
- **运动模糊**：需要上一帧 view-projection；相机快速旋转时可能拖影，代码里用 `shutter .5` 限制。
- **没有 TAA**：只有 FXAA/ sharpen，细几何（栏杆、链网）在运动中会闪。
- **阴影**：2048 在港口大场景里偏软；4096 更清晰但显存/带宽翻倍。
- **移动端**：`Pr` 的 test 档把 shadow 降到 1024、tex 256、volSteps 10、msaa 0；low 档 shadow 2048、tex 512、关闭 AO/planar；再低就只能 forward。

## 取舍与局限

- **自建链 vs 引擎**：完全可控、可按档位裁剪；代价是每个 pass 的 shader、尺寸、格式都要自己调，出错时容易黑屏。
- **效果全 vs 帧率**：这套链在独显上能看，在集显/移动端必须降档；它不是“无脑全开”的方案。
- **程序化天空 vs HDR**：省掉了 HDR 文件，但反射与光照的真实感不如实拍 HDRI；靠 PMREM + 调色补。
- **单文件 vs 可维护**：所有 shader 都是模板字符串，改一个 pass 要读懂 `Bg` 公共头和 uniform 绑定；没有热重载。

## 我能偷什么

1. **pass 工厂 + 统一全屏三角形**：`a()` 统一编译、统一 depthTest 关闭，新增效果只写 fragment shader。
2. **按画质档位裁剪 pass**：不是所有设备都值得 AO + 体积光 + Bloom；把 `volSteps/msaa/shadow` 做成配置。
3. **动态分辨率 + 帧时间目标**：比“固定 1080p”更能保住手感；目标是 21.5/17.4 ms，不是固定 FPS。
4. **失败回退**：后处理编译失败就关掉，不要黑屏；这是 WebGL 交付的底线。
5. **半分辨率 AO/体积光 + 双边模糊**：成本/画质平衡的经典套路。

**一句话记住：** 画面不是“一个 shader 做出来的”，而是 26 个 pass 按成本预算排出来的；真正难的是知道哪几个可以关。
