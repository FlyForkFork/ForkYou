# 05 性能：热路径、复杂度、优化

> 这篇回答：哪里最贵、为什么贵、怎么优化、有没有实测。

## 性能敏感路径

按每帧成本排序：

1. **后处理链**：`jy`（`index.html:4743`）约 26 次全屏绘制；1080p 下每次约 2.07M 像素，fill-rate 是主成本。
2. **纹理烘焙**：`Gg`（`index.html:5453`）在启动/首次用材质时生成 29 个 set × 3 张图；1024² 时单套约 16.8 MB（含 1.34 余量），总估算 137.7 MB。
3. **碰撞**：`moveCapsule`（`index.html:5453`）每个子步遍历全部 AABB，最多 3 次迭代；盒子数百级。
4. **敌人感知/寻路**：`Em`（`index.html:6065`）18 个敌人、5–9 Hz 感知；A* 只在目标变化时跑，上限 9,000 节点。
5. **绘制**：静态网格按材质合批（`io`，`index.html:5453`），但合批后单个大 mesh 仍然整体提交；Three.js 的视锥裁剪能挡掉部分。

## 复杂度

| 路径 | 复杂度 | 说明 |
|---|---|---|
| 后处理 | O(passes × pixels) | 约 26 pass；分辨率是平方级 |
| 纹理烘焙 | O(sets × D²) | 29 set × 3 target；D 由 `size × tex` 决定 |
| 胶囊移动 | O(substeps × 3 × boxes) | 子步数随速度增加 |
| 射线 | O(boxes) | 每次 raycast 遍历 AABB |
| A* | O(N log N) | N 上限 9,000；8 邻域 + 堆 |
| 敌人感知 | O(enemies × senseHz) | 18 × 5–9 Hz |
| 静态合批 | O(props) 一次性 | 启动时按 material UUID 合并 |

## 关键常量/缓冲区

| 项 | 值 | 证据 |
|---|---|---|
| 像素预算 | low 1e6 / medium 1.5e6 / high 2.3e6 / ultra 3.7e6 | `index.html:4744` |
| 动态分辨率目标 | 21.5 ms / 17.4 ms；最低 scale .6 | `index.html:4744` |
| 画质档位 | test/low/medium/high/ultra | `index.html:4191` |
| 纹理尺寸 | test 256 / low 512 / medium 1024 / high 1024 / ultra 2048（基础上限 1024，hero 才 2048） | `index.html:4191`、`index.html:5453` |
| 阴影 | 1024 / 2048 / 2048 / 4096 / 4096 | `index.html:4191` |
| 体积光步数 | 10 / 12 / 16 / 24 / 40 | `index.html:4191` |
| MSAA | 0 / 0 / 2 / 4 / 4 | `index.html:4191` |
| 导航网格 | 0.5 m，约 142×124 | `index.html:5453` |
| A* 上限 | 9,000 节点 | `index.html:5453` |
| 敌人池 | 飞鸥 10 / 猎犬 8 / 弹丸 32 / 残骸 5 | `index.html:6065` |

## 基准/实测

代码内置了 benchmark，但**本环境没有实测**：headless Chrome 在 DSH 沙箱里因命名管道权限失败（`platform_channel.cc:112 Check failed` / `OpenProcess: 拒绝访问`），无法创建 WebGL 上下文。所以下面只给方法，不给伪造的 FPS。

运行方式：

```bash
# 起静态服务器
python -m http.server 8000
# 浏览器打开（bench 需要非空值，或直接用 hash）
http://localhost:8000/index.html?bench=1
http://localhost:8000/index.html#bench
```

`?bench=1` 会关闭音频、自动开始，并调用 `eP(t)` 采样约 30 秒，输出 avg/p99/median、GPU、buffer、quality、draw calls、tris（`index.html:6202`）。运行中也可以在控制台调 `window.__stats()` 看当前 FPS、state、render stats。

## 优化手法

1. **动态分辨率**：`Hg` 按帧时间降 `scale`，最低 0.6；比固定 1080p 更能保手感（`index.html:4744`）。
2. **画质档位**：`Pr` 把 shadow/tex/volSteps/msaa/planar/bloom/motionBlur/rain 打包成 5 档；低端机 `?q=low` 直接关 AO 和平面反射（`index.html:4191`）。
3. **半分辨率 AO/体积光**：`jy` 用 half-res depth 与 AO/vol target，再双边模糊上采样（`index.html:4743`）。
4. **纹理按需烘焙**：`Gg` 的 `A()` 缓存每个 set，`prewarm()` 可预生成但默认不调用；只有用到的材质才付生成成本（`index.html:5453`）。
5. **静态合批**：`io` 按 material UUID + shadow + layer 合并，减少 draw call（`index.html:5453`）。
6. **对象池**：敌人/弹丸/残骸池化，避免 GC（`index.html:6065`）。
7. **低频感知**：敌人 5–9 Hz 感知，随机相位削峰（`index.html:6065`）。
8. **音频空闲合成**：`u_` 用 6 ms 时间片在空闲时预渲染 PCM，避免每帧合成（`index.html:5939`）。

## 瓶颈与反例

- **后处理是双刃剑**：26 pass 在独显上能看，在集显/移动端会先撞 fill-rate；`?q=low` 仍保留 bloom，只是关 AO/planar。
- **纹理内存被低估**：1024 档估算 137.7 MB，加上几何、render target、shadow map，实际显存更高；`stats().textureMB` 只算纹理，不算 target。
- **AABB 遍历是 O(boxes)**：盒子增多时 `moveCapsule` 和 raycast 都会线性变慢；没有空间划分（BVH/grid）。
- **合批的代价**：静态网格合并后单个 mesh 很大，视锥裁剪粒度变粗；远处一个集装箱可见也可能提交整批。
- **没有 occlusion culling**：港口遮挡多，但 Three.js 只做视锥裁剪；室内/集装箱后面的物体仍可能进 draw。
- **无实测**：所有性能结论是代码推断；真正的数字要用 `?bench=1` 在目标 GPU 上跑。

**一句话记住：** 这套项目的性能策略是“先保帧率，再保画质”：动态分辨率 + 五档画质 + 半分辨率后处理；它没有魔法，只有一堆可关的开关。
