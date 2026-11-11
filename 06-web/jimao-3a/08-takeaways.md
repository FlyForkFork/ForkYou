# 08 收获：可迁移的想法

> 这篇回答：哪些设计能偷，面试怎么讲。

## 5 条可迁移想法

### 1. 把“资产”换成“生成资产的程序”

- **问题**：贴图、几何、音频会把单文件项目撑到几百 MB。
- **做法**：`Tn` 写 27 个表面函数，`c3` 用 29 个 `{fn,size,tile,bump,hero,p,seed}` 参数描述材质，`Gg` 在 GPU 上烘焙 albedo/ORM/height 三张 MRT（`index.html:5453`、`index.html:5294`、`index.html:4833-5280`）。
- **为什么好**：下载体积从“几十张 1K/2K 贴图”降到“约 30 KB shader 代码”；新增材质只改参数表。
- **怎么用到我的项目**：先找“可计算的图案”（噪声、条纹、锈迹、瓷砖、链环），把它们做成 shader + 参数表；真实扫描资产仍走纹理压缩。

### 2. 分辨率与效果都要有“预算”和“档位”

- **问题**：后处理越多越好看，也越容易在集显/移动端掉帧。
- **做法**：`Pr` 五档控制 shadow/tex/volSteps/msaa/planar/bloom/motionBlur/rain（`index.html:4191`）；`Hg` 用 21.5/17.4 ms 目标动态调 scale（`index.html:4744`）。
- **为什么好**：同一份代码覆盖 test 到 ultra；先保帧率，再保画质。
- **怎么用到我的项目**：把“效果开关”做成配置，不要写死在渲染循环里；给一个最低档能跑的路径。

### 3. 用“导演”控制敌人，而不是给每个敌人写复杂 AI

- **问题**：18 个敌人同时进攻不可玩，全部排队又太假。
- **做法**：`Ui` 设 `maxTokens:2`、`maxTokensCrowd:3`、`tokenGap:1.25s`；`Em` 用 `requestToken/releaseToken` 限制同时攻击人数，用 `rally` 传播最后已知位置（`index.html:6065`）。
- **为什么好**：少量代码就能制造“被包围但有节奏”的体验；玩家能读出攻击窗口。
- **怎么用到我的项目**：先做全局“攻击许可”，再考虑按距离/威胁度加权；token 泄漏要有超时回收。

### 4. AABB + 网格 A* 是 FPS 的“够用物理”

- **问题**：完整物理引擎/NavMesh 对单文件项目太重。
- **做法**：`d3` 用 AABB 列表 + slab raycast + `moveCapsule` 子步进/圆形 push-out；导航用 0.5 m 网格、8 邻域 A*、9,000 节点上限、路径拉直（`index.html:5453`）。
- **为什么好**：零依赖、确定性、易调试；对“不穿墙、能上台阶、能绕集装箱”足够。
- **怎么用到我的项目**：静态关卡先用盒子近似；只有载具、布娃娃、堆叠才考虑物理引擎。

### 5. 单文件是约束，不是架构

- **问题**：单 HTML 很酷，但 6,214 行、无测试、无 license，维护成本高。
- **做法**：项目把模块拆成 `gM` 注册表（`index.html:6202`），但最终仍打成一个文件；模块边界靠函数和启动顺序维持。
- **为什么好**：交付极简，适合演示/评审/归档。
- **怎么用到我的项目**：把“单文件”当发布产物，不要当开发结构；源码仍应分模块、可测试、可构建。

## 面试 Q&A（模拟面试整理）

> 双 Agent 模拟：面试官 subagent 出 10 道 deep 题，面试者 subagent 第一人称回答；以下由主 Agent 按源码证据整理、纠错。

### Q1：1.43 MB 的单文件，体积账怎么拆？

**30 秒答案（第一人称）：** 脚本 1,390,078 B，其中 Three.js 约 701,719 B、游戏代码约 688,251 B；gzip 449 KB。传输成本不高，真正的成本是解析/编译和缓存粒度：改一行整包失效，6,214 行也难 review（`index.html:360`、`index.html:6202`）。拆 CDN 会减小首包、可独立缓存，但失去离线和单文件卖点，Three.js 的 MIT 声明仍要保留。

**追问：** 如果要求中端移动设备 3 秒内可玩，我会先砍 `tex` 档和后处理，用 `?bench=1` 验证；真机数据待查实。

### Q2：启动链里哪些模块可以“假活着”？

**30 秒答案（第一人称）：** `QC` 用 `r()` 包住每个模块，只有 `render` 和 `level` 没有 stub，其他模块失败可以回退到 `dr` 的占位实现（`index.html:6202`、`index.html:4191`）。`mats` 的 stub 至少要给默认材质和查询接口，否则关卡全灰；`enemies` 的 stub 要保住 spawn/retire/update 和存活计数，否则波次会误判清空。核心 shader 编译失败应该 fatal，不能假装活着。

**追问：** `if(t.ground.stub)` 会补一块地面，说明降级只保证流程跑完，不保证体验。

### Q3：29 套贴图的显存代价怎么算？

**30 秒答案（第一人称）：** `Gg` 每套生成 albedo/ORM/height 三张 D×D RGBA8，`b()` 每张累加 `O*O*4*1.34`（含 mipmap 余量）（`index.html:5453`）。按 `c3` 的 `size` 加权：low 约 34.4 MB、medium/high 约 137.7 MB、ultra 约 185.9 MB（推断，未实测）。1.34 是 mipmap 约 4/3 加对齐；`hero` 只在 `tex>=2048` 放到 2048，避免低档付四倍。29 个 set 是纹理族，48 个预设靠 tint/rough/wet/macro 复用，不是一预设一图（`index.html:5294`）。

**追问：** `update()` 四秒后释放的是烘焙用的 render target 和 shader program，成品 texture 仍在缓存里；所以省的是中间内存，不是最终显存（`index.html:5453`）。

### Q4：材质实例缓存和 shader program 缓存为什么要分开？

**30 秒答案（第一人称）：** `w()` 的缓存键管 `Material` 实例，包含 name、vertexColors、triplanar scale、doubleSide、interior、color；`customProgramCacheKey` 只拼 tint/triplanar/fx/acut，管编译后的 program（`index.html:5453`、`index.html:5294`）。颜色、缩放能走 uniform 就不该进 program key；会改变代码路径的 define 必须进，漏一个就会按首次编译顺序复用错程序，表现为“看起来随机”的材质错误。

**追问：** triplanar 的 `scale` 改了会改 UV 与 mip 选择，应该走 uniform 或单独 variant；两层缓存省编译，但键漏字段很难查。

### Q5：26 个全屏 pass，砍三个砍谁？

**30 秒答案（第一人称）：** 顺序是 depthcopy/depthhalf → AO → vol → composite → motion → bloom down/up → streak → adapt → dirt → grade → final，单帧约 26 个全屏 pass（`index.html:4743`、`index.html:4744`）。只能砍三个我砍 AO、vol、streak：先坏接触阴影、体积光层次和光斑，轮廓还在。AO 在 half-res 做 12 taps 再两次 blur，是用四分之一像素成本换可接受噪声；full-res 一次 12 taps 贵四倍，代价是细杆漏 AO。

**追问：** 单删 pass 未必够 60fps，还得配合动态分辨率；所有效果都该有“关掉仍能玩”的路径。

### Q6：动态分辨率的 21.5 ms 反馈环怎么防抖？

**30 秒答案（第一人称）：** `z()` 用 45 帧/900 ms 窗口滤单帧尖刺，3.5 s settle 防刚改完又回调，`upDelay` 指数退避防升档失败反复抖动（`index.html:4744`）。降档后重置 0.8 而不是保持 0.6，是因为档位已经换了像素预算和 MSAA，再压 0.6 是双重惩罚，0.8 留上升空间。振荡多出现在帧时间贴着 17.4 ms、负载忽轻忽重或热降频时；实测幅度待查实。

**追问：** 它只看帧时间，不看 GPU 利用率，vsync 下可能误判余量；更稳的做法是同时看 GPU timer（如果扩展可用）。

### Q7：45 m / 200° / 4 s 的敌人感知公平吗？

**30 秒答案（第一人称）：** 45 m/200° 是宽视野，0.11–0.19 s 感知间隔把发现延迟上限压到约 0.2 s；3.5 m 内忽略视锥，避免贴脸看不见（`index.html:6065`）。`exposure` 上 0.1、下 0.45 不对称：持续暴露才锁定，断线后快速遗忘；`loseSight 4s`、`searchTime 8s` 给追击粘性。spread 用 exposure 调制，让玩家刚被注意时有反应窗口；固定值会让首次交火像掷骰子。

**追问：** `seeT` 在 engage 用 `C*0.45`，是警戒下更快复检；代价是玩家刚脱离就被重新锁定。

### Q8：token 为什么是全局的？崩在哪？

**30 秒答案（第一人称）：** 2/3 个 token 限制同时开火人数，1.25 s `tokenGap` 拉开节奏，`lastType/wantT` 防同类垄断（`index.html:6065`）。gull 在 telegraph 阶段被杀，必须在 `retire`/死亡路径 `releaseToken`；泄漏会让 token 永不归还，敌人只转圈不开火。gull 用 projectile 是可躲、需 32 发池；hound 贴脸，hitscan + 近战省弹丸管理，代价是瞬时命中不够公平。

**追问：** token 是全局单例，跨区多队接战会互相饿死；这是已知局限，解法是按区域/威胁度分组。

### Q9：AABB + 网格 A* 的边界在哪？

**30 秒答案（第一人称）：** 不用物理引擎换确定性、零依赖，代价是只支持 AABB。`ob.M()` 把旋转道具切最多 10 段 AABB，接缝会留凹角或重叠，胶囊可能卡住或滑角（`index.html:5453`）。`moveCapsule` 按 `ceil(hypot(dx,dz)/(radius*0.6))` 子步进、每步最多 3 次 push-out，防 6.4 m/s 穿墙；nav 用 0.5 m 网格、9,000 节点上限、typed array + generation stamp，省每次查询的清零与分配。

**追问：** 斜坡/楼梯只能近似，没有连续碰撞检测；高速冲刺仍可能穿薄盒，这是明确边界。

### Q10：如果重做，优先级怎么排？

**30 秒答案（第一人称）：** 我会先拆构建但保留“单文件产物”，再离线烘焙，再做关卡 JSON schema，最后才动 AI/物理（`index.html:5453`、`index.html:4191`）。当前 draw call 主要来自按 material UUID/cast/receive/layer 合并的静态批次，再加敌人、viewmodel、粒子和未合并的 `noMerge` 子树；最容易漏的是动态道具与透明贴花。验收看首屏、显存、`?bench=1` 的 p99 和包体，具体阈值待查实。

**追问：** 顺序是先让项目改得动、测得准；直接重写 AI 风险最高，因为没有回归测试兜底。

## 吹B一句话

**1.4 MB 的港口，不是压缩出来的，是算出来的。**

## 不该抄的地方

- **无测试、无 license**：不能直接用于商业或团队协作；至少补 `?bench=1` 的 smoke、材质/关卡 schema 校验、关键模块单测。
- **关卡数据硬编码**：3 个中继、42 个出生点、55 个掩体点全在 `C1` 里（`index.html:5453`）；第二张图应抽 JSON + schema。
- **26 个 pass 全开**：移动端必须降档；不要把“桌面独显能跑”当默认。
- **6,214 行单文件**：演示可以，长期维护应拆模块、保留构建产物。

**一句话记住：** 单文件是交付约束，程序化资产是体积杠杆，token 是 AI 的导演，AABB + 网格 A* 是 FPS 的够用物理；这四件事比“3A”两个字更值得学。
