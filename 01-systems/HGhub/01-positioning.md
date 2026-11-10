# 01 定位：HGhub 是什么

> 这篇回答：它是什么、谁在用、解决什么痛点、凭什么值得读。

## 一句话

HGhub 是一个基于 Tauri 2 的「黄果短剧」第三方客户端：用 React 复刻竖屏信息流的交互，用 Rust 重写原本必须由浏览器/WebView 承担的网络与媒体管道，让同一个代码库跑在 Windows、macOS、Linux、Android 四个平台上。

## 谁在什么场景下用它

上游站点 `huangguoai.com` 是一个短剧内容站。它在浏览器里能看，但体验是网页式的：竖向滚动没有吸附、没有手势倍速、没有预加载下一条、iOS Safari 全屏后容易掉播放。HGhub 把这类站点的「网页」变成「App」：竖屏一屏一条、上下滑动切剧、长按 2 倍速、横屏自动全屏。

作者在 README 里对项目定位写得很克制，值得原样引一次：

> 基于 Rust 与 Tauri 2 的跨平台界面与交互实践项目。（`README.md`）

这句话不是谦虚，是准确的：真正被作者反复打磨的是**交互细节**（手势、seek 提交模型、旋转兜底）和**网络/媒体层的工程防御**，而不是业务功能。同一份 README 也明确划了维护边界：

> 维护者后续仅主动维护 UI/UX、交互细节与用户体验，不再主动跟进上游数据获取、解析或播放链路适配。（`README.md`）

这是理解整个仓库的钥匙：**上游接口一旦变化，项目不承诺跟进**。两条 `codex/*` 分支（见 [06 分支](06-branches.md)）正是在删减「跟进上游播放接口」的那部分代码。

## 没有它之前，人们怎么做

三条现实路径都不好走：**直接浏览器看**（CORS 拦分片、封面是密文、手势靠 CSS 硬凑）；**Electron 壳**（包体 100MB 起步、移动端无官方支持）；**纯前端 + 反向代理**（要自己运维代理服务器，把用户流量集中到一个出口）。

HGhub 选的是第四条：**用 Tauri 的自定义协议把「代理」做进客户端本地**——请求仍从本机发出，但绕开了 WebView 的同源策略。

## 它解决的三个痛点

### 痛点 1：WebView 拿不到跨域媒体

`media.rs` 顶部注释把问题写得很直白：

> 站点封面 AES-128-CBC 密文，m3u8 分片/key 被 WebView CORS 拦，统一走本地自定义协议。（`src-tauri/src/media.rs:1-5`）

解法是注册一个 `hg` 协议（`src-tauri/src/lib.rs:79-132`），前端所有封面和播放地址都被改写成 `hg://localhost/img?u=...` / `hg://localhost/hls?u=...`（`src/api.ts:35-39`）。对 WebView 来说这是同源的本地资源，CORS 问题消失；真正的跨域请求发生在 Rust 的 `reqwest` 里，那里没有同源概念。

### 痛点 2：代理设置了却不生效

这是第三方客户端最经典的坑，`net.rs` 顶部用了 20 行注释解释：

> 客户端流量全部走本文件 reqwest，与 WebView2 无关，不共享浏览器代理/证书库；reqwest 只有开 system-proxy 才读 Windows 注册表代理；即使开了也不支持 PAC（AutoConfigURL），只认固定代理；Android 无注册表，系统 Wi-Fi 代理不被采用，只有 VPN/TUN 有效。（`src-tauri/src/net.rs:1-20`，摘要）

对应的依赖声明在 `src-tauri/Cargo.toml` 里显式写出 `system-proxy` feature，并附注释说明漏掉它的症状是「浏览器能开官网、HGhub 打不开」。这类「注释即运维手册」的写法在本仓库反复出现。

### 痛点 3：移动端播放被打断

iOS/Android 的 WebView 在旋转、切全屏、切后台时会挂起视频层。HGhub 的应对是三层：

- `keepPlayingThroughTransition` 在 [50,150,300,500,800,1200] ms 分批重申 `play()`（`src/components/Feed.tsx:214-238`）；
- `usePlaybackActivity` 用 `active` / `wanted` 双状态门控，失活时 `pause + hls.stopLoad()`，恢复时按记忆的意图续播（`src/usePlaybackActivity.ts`）；
- 提前 0.35s / 1.5s 触发 `onEnded`，绕开部分 HLS 流标称时长比最后分片长 0.5~1.2s 的问题（`src/components/VideoSurface.tsx`）。

## 竞品对比

| 方案 | 定位 | 核心差异 | License | 成熟度 |
|---|---|---|---|---|
| **HGhub** | 单一站点的跨平台客户端 | Tauri 2 + 自建 `hg://` 协议；Rust 侧做 DNS 固定、重定向逐跳检查、HLS 全 URI 改写；有播放诊断日志体系 | PolyForm Noncommercial 1.0.0 | 1.2.1，四平台 Release 自动构建 |
| **同类 Tauri 影视壳**（如各类「XX影视」客户端，待查实具体仓库） | 多源聚合 | 通常直接在前端 fetch 或起本地 HTTP 服务，缺少不可信目标策略；移动端适配较弱 | 多为 MIT / 无证 | 参差 |
| **Electron 壳**（如 movie-web 衍生客户端） | 网页封装 | 包体大、移动端缺失；代理与 CORS 问题同样存在但常被忽略 | 视项目 | 高（生态成熟） |
| **stclock1988/hghub-ios**（被本项目引用） | 纯 iOS 原生 | Swift + AVPlayer，播放层更稳；不跨平台 | 待查实 | 单一平台 |

对比表里最值得注意的一列是「核心差异」而不是「功能」：HGhub 的差异化不在能看什么，而在于**它把网络策略当成一等公民**。`network_policy.rs` 394 行里有 160 行是测试，覆盖 26 个私网/保留地址、`127.1`、`2130706433`、`0x7f000001`、`localhost.`、`file:///`、`javascript:` 这些绕过写法——这不是普通影视壳会做的事。

## 为什么是现在

1. **Tauri 2 支持移动端**。Tauri 1 只有桌面；`tauri.conf.json` 的 `android.minSdkVersion: 24`、`tauri.ios.conf.json` 的 `minimumSystemVersion: 15.0` 是这套能力的痕迹。
2. **hls.js 1.6.19 带上了 macOS/iOS 的 ManagedMediaSource seek 缓冲修复**（`docs/playback-diagnostics.md` 记录为上游 PR #7984）。
3. **`reqwest` + `rustls` 成熟**，能在不依赖系统 OpenSSL 的前提下做固定 DNS 的 TLS 连接。

## 项目健康度

| 指标 | 值 | 日期 |
|---|---|---|
| Stars | 7518 | 2026-11-10 |
| 版本 | 1.2.1 | 2026-11-10 |
| 主分支文件数 | 147 | 2026-11-10 |
| 代码规模 | 约 11093 行（src + src-tauri/src + tests + scripts） | 2026-11-10 |
| Rust 单测 | 28 passed / 0 failed / 5 ignored（`docs/security.md` 记录） | 2026-11-07 |
| 前端回归 | html-security 31 项、player-seek 12 项、security-settings 8 项 | 2026-11-07 |
| CI | 5 条 workflow（release / playback / build-ios / build-linux / build-macos） | 2026-11-10 |
| 维护状态 | 作者声明只维护 UI/UX，不跟进上游接口 | 2026-11-10 |

需要客观指出两点：

- **测试全部是「本地可复现」类型**。`docs/security.md` 自己记录了 3 个失败用例：`mirrors_live`、`live_play_chain`（DNS 解析到私网被严格策略拒绝）、`playlist_rewrite_works`（旧地址 403）。也就是说，联网路径的健康度**没有 CI 保障**。
- **Windows / Android 实机播放未完成验证**（`docs/security.md` 自述）。四个平台里只有 Linux WebKitGTK 做过较完整的 WebDriver 回归。

## License 的实际含义

LICENSE 是 PolyForm Noncommercial 1.0.0，不是常见的 MIT/Apache。这不是形式条款，README 里点名了禁止的行为：销售、广告、卡密、VIP、付费解锁。

两个细节值得记：

1. **v1.0.1 及更早是 MIT**，自 v1.1.0 起换证。已按 MIT 获得的授权不因换证而撤回（`README.md`）。这意味着早期 fork 的授权状态与新版本不同。
2. 这是**源码可见（source-available）而非开源（open source）**。按 OSI 定义，禁止商业使用即不构成开源。本目录的分析属于学习研究用途。

## 应用地址

- 仓库：https://github.com/Minireel/HGhub
- 发布：https://github.com/Minireel/HGhub/releases（`release.yml` 产出 Windows NSIS、macOS universal dmg、Android split-per-abi APK）
- 官网：无独立官网，应用内「关于」复制的是仓库地址与站点地址

## 一句话结论

HGhub 是一个**把 WebView 的短板当作主要敌人**的客户端：它的架构不是围绕业务功能长出来的，而是围绕「怎么让一个受限的 WebView 播好受保护的 HLS 流」长出来的。

**一句话记住：** 读 HGhub 不要读它的页面，读它的 `net.rs` 顶部注释和 `media.rs` 的 URI 改写——那才是这个项目真正的设计文档。
