# 08 收获：可迁移的想法与面试卡

> 这篇回答：哪些做法能搬走、面试被问到时怎么答、哪些坑别跟着踩。

## 面试卡的来源（必须说明）

RULES 要求面试卡由「面试官」「面试者」两个独立 subagent 生成。**本次未执行**：本会话 subagent 委派深度已用尽（remaining levels 0），无法创建子 agent。下面的 8 张卡由分析者本人按 default 档难度拟定，题目与答案均基于实际读过的代码、证据可核，但缺少独立第二视角的校验。

## 可迁移想法

### 1. 用自定义协议绕过 WebView 的 CORS

`register_asynchronous_uri_scheme_protocol("hg", ...)`（`src-tauri/src/lib.rs:79-132`），前端把跨域媒体 URL 改写成 `hg://localhost/xxx?u=<encoded>`，真实请求在 Rust 里发。对 WebView 是同源本地资源，CORS 消失；比本地 HTTP 服务少一个端口和一套生命周期管理，比 `tauri-plugin-http` 好在能配合 `MediaSource` 的流式分片。

**迁移要点**：平台 origin 前缀不同——Windows/Android 用 `http://<scheme>.localhost`，macOS/iOS/Linux 用 `<scheme>://localhost`（`src-tauri/src/media.rs:21-24`），前端必须同步判断（`src/api.ts:29`），否则封面全裂且无任何报错。

### 2. 把「不可信目标策略」抽成独立模块

`network_policy.rs` 只回答「这个 URL / 这组 IP 能不能连」，不碰 HTTP；所有出口（初始请求、每跳重定向、媒体代理、外链）都过它。好处是策略能被穷举测试——394 行里 160 行是测试，覆盖 26 个私网/保留地址、`127.1`、`2130706433`、`0x7f000001`、`localhost.`、`file:///`、`javascript:`（`network_policy.rs:231-393`）。

**迁移要点**：任何「用户能提供 URL」的功能都该有这样一个纯函数模块，测试用例直接抄 OWASP 的 SSRF 绕过清单。

### 3. FakeIP 段必须显式放行

Clash/Mihomo 的 FakeIP 把域名解析到 `198.18.0.0/15`。无脑拦私网 = 100% 得罪最需要代理的核心用户，且症状是「全部请求失败」，极难定位。项目显式放行并写进测试，诊断里还返回 `has_fake_ip` 区分「解析到 FakeIP」与「解析失败」（`network_policy.rs:91-123`、`net.rs:314-329`）。

### 4. DNS 结果固定进客户端 + 不延长 TTL

`client_for` 把 `resolve_to_addrs` 结果固定进 reqwest，`CLIENT_TTL = 30s` 且**命中不延长**（`net.rs:151-194`）——否则高频请求会让缓存永不过期，CDN 切换后永远连旧地址。key 带 `strict` 标志；重定向每跳重新解析，否则 DNS 投毒可绕过初始检查。

### 5. 代理客户端要能自愈

代理软件开关后连接池里的旧连接会卡在 tunnel error 直到超时。`heal_client` 在检测到 Connect/timeout/refused/DNS/proxy 错误时重建客户端，3 秒节流（`net.rs:275-295`）。检测关键词：Connect、timed out、refused、dns、tunnel、proxy。

### 6. HLS 清单要穷举所有 URI 属性

漏 `#EXT-X-KEY` 黑屏、漏 `#EXT-X-MAP` 解码器起不来、漏 `#EXT-X-MEDIA` 切音轨静默失败、漏 `#EXT-X-SESSION-KEY` 切码率黑屏、漏 `#EXT-X-PART`/`#EXT-X-PRELOAD-HINT` 低延迟卡住。`#EXT-X-CONTENT-STEERING` 必须整条丢弃——它指向另一组 CDN，会让播放器绕过改写且**不报错**（`media.rs:210-256`）。属性值含引号内逗号，按逗号 split 会切坏 `NAME="English, US"`（`media.rs:148-164`）。

### 7. 主动关掉会「派生直连」的库特性

hls.js 的 `interstitialsController` / `contentSteeringController` / `enableInterstitialPlayback` 会从清单里的 JSON 派生新的播放 URL，一旦派生就绕过代理层（`VideoSurface.tsx:184-210`）。任何「你在中间做改写」的场景，都要审查下游库有没有「根据响应内容自己找新地址」的能力。

### 8. 「按下预览、松开提交」的 seek 模型

每次 `pointermove` 都写 `currentTime` 会产生几十次 seek，播放器来不及响应。`useSeekInput` 按下捕获指针、移动只更新预览、松开才提交一次（`useSeekInput.ts`）。衍生 bug 见 `docs/playback-seek.md`：隐藏控制条时给整条加 `pointer-events: none`，唤醒时点击落到视频触发暂停。适用于任何「拖拽 + 预览 + 昂贵提交」的交互。

### 9. 诊断日志用哈希 ID 跨进程对齐

Rust 的 `resource_id` 用 FNV-1a 32 位把 URL 哈希成 `r{hash:08x}`（`playback_log.rs:40-46`），前端 `mediaResource` 用同一算法（`playbackDiagnostics.ts:81-89`），测试断言 `resource_id("hello") == "r4f9f2cab"` 防漂移。日志因此可安全外传（`scrub` 把含 `://` 的字符串替换成 `[redacted]`），同时前后端能对上同一资源。

### 10. 播放活跃门控：`active` + `wanted` 双状态

「用户想播」与「现在在播」是两件事。只看 `video.paused` 就分不清「用户主动暂停」和「切走时被我们 pause」。`usePlaybackActivity` 用 `wanted` ref 记意图：失活时 `wanted = !v.paused` 再 pause，恢复时按 `wanted` 续播；另挂 play/playing guard 拦掉原生控件与 PiP 的绕过（`usePlaybackActivity.ts`，70 行）。

## 面试 Q&A 卡

### 卡 1：为什么用自定义协议而不是本地 HTTP 服务器？

本地 HTTP 服务要多开端口、处理冲突、退出与移动端后台被杀时清理。`register_asynchronous_uri_scheme_protocol` 让请求在进程内被拦截，零端口零清理，对 WebView 是同源资源。代价是无法被 curl/ffmpeg 复用，调试只能靠日志。

**追问**：Windows 上为什么用 `http://hg.localhost`？——WebView2 需要这种形式才当安全上下文，否则 `MediaSource` 被禁用（`media.rs:21-24`、`api.ts:29`）。

### 卡 2：m3u8 改写漏了哪些标签会出问题？

六类，见可迁移想法 6。最阴的是 `#EXT-X-CONTENT-STEERING`：它不报错，只让播放器悄悄切到直连地址然后 CORS 失败。

**追问**：引号内逗号怎么办？——`hls_attributes`（`media.rs:148-164`）做引号感知解析。

### 卡 3：严格模式为什么放行 `198.18.0.0/15`？

那是 Clash 的 FakeIP 段。按「私网一律拒绝」处理，这批用户 100% 连不上且症状难定位。真正要拦的 `10/8`、`192.168/16`、`127/8` 全部仍拒绝，测试覆盖 26 个地址（`network_policy.rs:91-123`）。

### 卡 4：DNS 缓存 30 秒，为什么命中不延长 TTL？

延长会让高频请求的缓存永不过期，CDN 切换后连旧地址。key 带 `strict`（两种模式下解析结果不同）；重定向每跳重新解析，否则 DNS 投毒可经一次重定向绕过初始检查。缓存满 64 条整体清空而非 LRU——条目本来就少，维护成本不划算（`net.rs:164-194`）。

### 卡 5：为什么镜像线路禁止登录？

镜像是从发布页动态发现的域名，可信度低。`trusted_auth_origin` 只认两个固定站点，`edge` 里带 token 或登录/注册路径就强制要求可信 origin（`net.rs:62-64`、`net.rs:476-485`）。`docs/review-followup.md` P3-6 记录了这个取舍：按 origin 保存多份凭据属于新增账号管理能力，需单独设计。

### 卡 6：`usePlaybackActivity` 为什么需要两个状态？

`wanted` 记用户意图，`active` 记当前页。失活时先 `wanted = !v.paused` 再 pause，恢复时按 `wanted` 续播。第三个 effect 挂 play/playing guard 拦原生控件与 PiP。

### 卡 7：seek 为什么要「先 startLoad 再写 currentTime」？

目标位置可能未缓冲，直接写 `currentTime` 会让 hls.js 先内部 seek 再重载，容易卡住或触发 `BUFFER_STALLED`。target 还要夹到 `[0, duration - 0.15]` 避免触发 `ended`；`seeked` 不来时 350ms 兜底（`VideoSurface.tsx:78-118`）。

### 卡 8：这个项目的测试有什么结构性缺口？

联网路径完全没有 CI 保障。Rust 单测 28 passed / 5 ignored，ignored 的全需真实网络；`docs/security.md` 自己记录三个联网测试在严格模式下失败（DNS 解析到私网被拒）。「上游接口是否还兼容」没有自动化保障，这正是作者声明「不跟进上游」的技术底气，也是最大脆弱点。

**追问**：那靠什么保证质量？——四层：`pnpm build` 类型检查（同时检查 src 与 tests）、Rust 单测、手动浏览器回归（31+12+8 项）、一条 Playwright CI（`playback.yml` 跑真实播放并上传诊断 artifact）。

## 吹B一句话

1. 一个第三方短剧客户端，在 Rust 里手写了 m3u8 解析、AES-CBC 解密、SSRF 防护和跨进程日志关联——这些通常出现在安全产品里。
2. `network_policy.rs` 394 行里 160 行是测试，覆盖 `127.1`、`2130706433`、`0x7f000001` 这些绕过写法。
3. 诊断日志能用同一个 FNV-1a 哈希把前后端资源对上，同时保证日志里不出现任何 URL。
4. 它显式放行 Clash 的 FakeIP 段——「不做就 100% 得罪核心用户、做了也没人夸」的细节。
5. 播放器被打断拆成三层防御：旋转后 6 次重申 play、`active`/`wanted` 门控、提前 0.35s 触发连播。

## 局限与不该抄的地方

**硬编码 AES key/IV**（`media.rs:26-27`）。上游不变时没问题，换 key 就要发版。key 可能轮换的场景应做成可配置 + 远程更新。

**非 LRU 缓存淘汰**（`media.rs:44-52`）。满则随机删一个。36 条分片、单条最大 4MB，随机淘汰命中率明显低于 LRU；短剧线性播放能凑合，点播长视频会暴露。

**1329 行的 `Feed.tsx`**。边界清楚（手势 + 翻页），但改手势要在大文件里导航。至少该把触摸判定（`Feed.tsx:547-690`）、捏合（`471-545`）、进度条（`692-700`）拆成独立 hook。

**「先下载完整分片再返回」**。作者自己承认（`docs/playback-investigation-20261108.md`）。seek 中位数 1282ms、最慢 2986ms 里 2603ms 是分片下载。

**分支名与内容不符**。`codex/fix-ios-build` 里没有 CI 改动；`codex/source-only-maintenance` 的 message 说 docs 但 diff 是代码删除。任何依赖 commit message 的变更追踪都会失效。

**非商业许可的传染性**。PolyForm Noncommercial 1.0.0 不是开源许可；「已按 MIT 获得的授权不撤回」只对 v1.0.1 及更早成立。

**一句话记住：** 能搬走的是「把不可信输入的所有出口收敛到一个可穷举测试的策略模块」这一个思路，其余实现都是它在不同层面的投影。
