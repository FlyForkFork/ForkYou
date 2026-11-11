# 04 深挖：物理与导航——没有物理引擎的 FPS 怎么跑

> 这篇回答：没有 Rapier/Cannon/PhysX，玩家怎么不穿墙、敌人怎么绕集装箱、子弹怎么命中？

## 问题

一个港口 FPS 至少需要：

- 玩家胶囊与集装箱、护栏、楼梯、墙体的碰撞。
- 地面高度：码头、船甲板、台阶、海面。
- 射线：射击命中、视线判断、AI 感知。
- 敌人寻路：从出生点到玩家、到掩体、到中继。
- 性能：18 个敌人 + 玩家 + 大量静态碰撞体，不能每帧做三角面检测。

## 朴素做法为什么不够

- **引入完整物理引擎**：Rapier/Cannon 的 WASM/JS 体积、初始化、刚体同步都是成本；这个项目连图片都没有，不会为碰撞多带一个引擎。
- **逐三角面 raycast**：港口有大量集装箱、栏杆、管道，三角面数量大；每帧多次 raycast 会拖垮 CPU。
- **导航网格（NavMesh）**：需要离线烘焙，单文件项目没有构建管线；动态门/障碍也难处理。
- **只做地面高度**：玩家能穿过集装箱，AI 直线撞墙。

## 这个项目怎么做

### 1. AABB 世界：`d3`

`d3`（`index.html:5453`）维护一个 AABB 数组 `e`，每个盒子有 `min/max/surface/tag/noNav/bulletOnly/playerOnly`。关卡里的 `col/place` 会调用 `addBox()`；`build()` 生成导航网格。

- `raycast(origin, dir, maxDist)`：对每个 AABB 做 slab 相交，返回最近命中、法线、表面类型；还处理地面 `groundY` 和海面 `seaY`。
- `lineOfSight(a, b)`：把 `b-a` 归一化后 raycast，距离减 0.05 避免自遮挡；AI 感知和子弹都用它。
- `groundHeight(x, z)`：返回该点最高的可站立面，供玩家/敌人贴地。

### 2. 胶囊移动：`moveCapsule`

`moveCapsule(pos, delta, dt, radius=.32, height=1.8)`（`index.html:5453`）：

1. 把水平位移拆成子步：`U = ceil(hypot(dx,dz) / (radius*.6))`，防止高速穿墙。
2. 每个子步先水平移动，再对每个 AABB 做“圆 vs 矩形”的 push-out；最多 3 次迭代解决角落。
3. 垂直方向：先算目标 `y`，再找脚下最高的 `max.y` 和头顶最低的 `min.y`。
4. 处理地面吸附、天花板碰撞、台阶高度 `u1`；返回 `onGround/hitWall/hitCeil/surface`。

这套逻辑没有刚体、没有摩擦、没有旋转；但 FPS 只需要“不穿墙、能上台阶、能落地”，它刚好覆盖。

### 3. 导航网格：0.5 m 网格 + A*

`d3` 的 `nav`（`index.html:5453`）：

- `Ls=.5`，世界范围 `x∈[-40,31]`、`z∈[-32,30]`，所以约 **142×124 = 17,608 格**。
- `build()` 把每个 AABB 投影到网格，标记不可走；`isWalkable` 做边界检查。
- `findPath(start, goal)`：8 邻域 A*，二叉堆，节点上限 **9,000**；拐角检查防止切角穿墙。
- 找到路径后用 `h()` 做“拉直”：从当前点尽量跳到更远的可见点，减少 zigzag。
- `randomPoint(center, radius)`：随机采样 24 次找可走点，给巡逻/搜索用。

### 4. 玩家控制器：`x_`

`x_`（`index.html:5939`）把输入转成速度，再交给 `moveCapsule`：

- `Mt` 常量：walk 3.8 / sprint 6.4 / crouch 1.9 / ADS 2.4 / gravity 21 / jumpApex 1 / coyote .12 / jumpBuffer .13 / radius .32 / height 1.8。
- 地面加速 34、减速 26；空中控制更低。
- 跳跃用“顶点高度 + 重力”反推初速度；coyote time 允许离开平台后 0.12 s 内起跳；jump buffer 允许落地前 0.13 s 按跳。
- 下落伤害、落水救援、镜头 bob、recoil、shake、ADS/sprint FOV 都在这一层。

### 5. 敌人导航

`Em` 的猎犬用 `i.nav.findPath(pos, target)`；飞鸥不用网格，用轨道 + `avoid` 向量。敌人不直接修改玩家位置，只通过 `moveCapsule` 或自己的移动逻辑更新。

### 6. 射线与命中

武器 `zv`（`index.html:5939`）从相机/枪口发 raycast，命中敌人碰撞盒后算伤害、部位倍率、击退；`d3.raycast` 同时返回 `surface`，用于弹着特效（金属火花、混凝土灰尘）。AI 的 `lineOfSight` 复用同一套 raycast，保证“看得见”和“打得到”一致。

## 代码证据

| 结论 | 证据 |
|---|---|
| AABB 数组、raycast、groundHeight | `index.html:5453` |
| `moveCapsule` 子步进 + push-out | `index.html:5453` |
| 0.5 m 网格、A*、9,000 节点上限 | `index.html:5453` |
| 玩家常量与 coyote/jump buffer | `index.html:5939` |
| 武器 raycast/伤害 | `index.html:5939` |
| 猎犬使用 nav.findPath | `index.html:6065` |

## 复杂度/性能/边界

- **碰撞**：`moveCapsule` 每个子步遍历全部 AABB，最坏 3 次迭代；盒子数量是关卡静态物体量级（数百），可接受，但这是 O(boxes) 每帧。
- **导航**：A* 最坏 9,000 节点；只在目标变化时调用。网格 17,608 格，`Uint8Array` 只占约 17 KB。
- **射线**：每次 raycast O(boxes)；AI 感知 + 子弹 + 视线，每秒数百次，仍是可控量级。
- **边界**：AABB 不支持旋转盒子/斜坡/动态刚体；楼梯用台阶高度近似；导航网格不处理动态障碍（门、残骸）；敌人可能卡在狭窄角落。
- **精度**：`radius*.6` 子步进在高速冲刺时仍可能穿透极薄盒子；项目用 0.5 m 网格和较厚道具规避。

## 取舍与局限

- **AABB vs 精确碰撞**：AABB 便宜、可预测、易调试；代价是斜放集装箱的碰撞会比视觉大/小。
- **网格 A* vs NavMesh**：网格无需烘焙、动态标记简单；代价是路径贴格、拐角多，靠拉直补。
- **胶囊 vs 刚体**：胶囊不会翻倒、不会堆叠；对 FPS 足够，对“推箱子/物理谜题”不够。
- **无测试**：碰撞和寻路的回归只能靠试玩；一个 `u1` 改错就会卡台阶。

## 我能偷什么

1. **AABB + slab raycast**：静态关卡用盒子近似，代码量小、性能稳；先别上物理引擎。
2. **胶囊子步进 + 圆-矩形 push-out**：比完整 swept collision 简单，能解决大多数 FPS 穿墙。
3. **0.5 m 网格 + A* + 路径拉直**：不需要 NavMesh 烘焙，适合程序化关卡。
4. **`lineOfSight` 与射击共用 raycast**：AI 和武器看到的是同一个世界，减少“隔墙打人”的 bug。
5. **coyote time / jump buffer**：手感的关键不是物理精度，而是输入宽容度。

**一句话记住：** 它没有“物理”，只有“胶囊不许进盒子 + 网格上找条路”；对 FPS 来说，这已经够用，而且便宜得多。
