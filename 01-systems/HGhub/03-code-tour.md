# 03 代码走读：从入口到核心

> 这篇回答：先读什么、主流程怎么走、加功能改哪里、测试怎么跑。

## 仓库地图

```text
HGhub/
├── index.html                 # Vite 入口，含提前应用主题的内联脚本
├── package.json               # 1.2.1，scripts 全在这
├── vite.config.ts             # :1420 严格端口，__APP_VERSION__ 注入
├── pnpm-workspace.yaml        # hoisted，exFAT 兼容
├── src/                       # 前端（React 19 + TS）
│   ├── main.tsx               # ReactDOM 挂载 + 全局错误上报
│   ├── App.tsx                # 壳层：桌面/移动两套布局、导航栈、返回键
│   ├── store.tsx              # 全局状态 + localStorage 持久化
│   ├── api.ts                 # invoke 封装 + hg:// URL 构造
│   ├── html.ts                # DOMPurify 清洗 + 图片代理重写
│   ├── playbackDiagnostics.ts # 前端诊断事件队列
│   ├── usePlaybackActivity.ts # active/wanted 播放门控
│   ├── useSeekInput.ts        # 按下预览、松开提交
│   ├── back.ts                # 单槽返回拦截
│   ├── components/
│   │   ├── Feed.tsx           # 1329 行，竖屏信息流（最重）
│   │   ├── VideoSurface.tsx   # 406 行，hls.js 播放内核
│   │   ├── Player.tsx         # 253 行，详情页独立播放器
│   │   ├── PlayerControls.tsx # 控制条
│   │   ├── Panels.tsx         # 选集 / 评论面板
│   │   ├── LinePicker.tsx     # 线路选择
│   │   ├── DesktopChrome.tsx  # 桌面标题栏
│   │   └── ResizeHandles.tsx  # 无边框窗口缩放热区
│   └── pages/                 # Settings / Category / Search / Posts / Profile / Home
├── src-tauri/
│   ├── Cargo.toml             # 依赖 + 关键注释（system-proxy）
│   ├── tauri.conf.json        # CSP / 窗口 / bundle
│   ├── tauri.ios.conf.json    # iOS 覆盖
│   ├── tauri.macos.conf.json  # macOS 覆盖（create:false）
│   ├── capabilities/default.json
│   └── src/
│       ├── main.rs            # 5 行，调 lib::run()
│       ├── lib.rs             # 装配 + 协议注册 + 34 个命令
│       ├── api.rs             # 命令实现
│       ├── net.rs             # 传输层（875 行）
│       ├── network_policy.rs  # 目标策略（394 行）
│       ├── media.rs           # 媒体代理（585 行）
│       ├── lines.rs           # 线路 / 镜像
│       ├── session.rs         # 会话
│       ├── playback_log.rs    # 诊断日志
│       ├── logging.rs         # 调试日志
│       └── macos_titlebar.rs  # macOS 窗口
├── tests/                     # 浏览器内回归（html + tsx）
├── scripts/                   # test-playback / test-api-loading / sync-android-icons
├── docs/                      # 7 篇自述文档（安全、播放诊断、缓存审计…）
└── rules/                     # Mihomo/Sing-box 分流规则
```

## 构建/运行入口

三个入口，从粗到细：

1. **进程入口**：`src-tauri/src/main.rs:1-5`，只有一行 `huangguo_client_lib::run()`，加 `windows_subsystem = "windows"`（release 不弹控制台）。
2. **装配入口**：`src-tauri/src/lib.rs:46-173` 的 `run()`。这里做四件事：注册 opener 插件（关掉自动接管链接）、`manage(Api::new())`、在 setup 里把 app_data_dir 绑给 `net::bind_base` / `playback_log::bind` / `session.bind`、注册 `hg` 协议与 34 个命令。
3. **前端入口**：`src/main.tsx` → `App.tsx`。`main.tsx` 先 `installPlaybackPageEvents()` + `initPlaybackLog()`，再挂 `window error/unhandledrejection` 上报，最后渲染 `<AppProvider><App/></AppProvider>`。

一个容易漏的细节：macOS 的窗口**不是** `tauri.conf.json` 创建的。`tauri.macos.conf.json` 里写 `window.create: false`，改由 `lib.rs` 在 setup 里调 `macos_titlebar::create_main_window`，这样才能读到 AppKit 红绿灯按钮的实际尺寸做居中。

## 主流程走读

### 第 1 步：启动时同步安全模式

`app_boot`（`src-tauri/src/api.rs:290-300`）返回 `user / logged_in / base / strict_security / cli_relaxed`。前端 `store.tsx` 的 `boot()` 拿到后：

- 把 `strict_security` 写进 `html.ts` 的模块级 `strictSecurity`（`src/html.ts:6-18`）；
- 设置 `strictSecurityReady`，在此之前设置页的开关是 disabled 的，`setStrictSecurity` 会抛「安全设置尚未读取，请重新启动应用」。

为什么必须等 Rust：`docs/review-followup.md` 记录 P2-4 修正「移除 localStorage 安全偏好，Rust security.json 是持久化真源，前端启动默认严格」。前端不再自己存安全偏好。

### 第 2 步：首页拉列表

`src/pages/Home.tsx:15-40` 的 `load(p)`：

```ts
const res = await api.feed(p, 10);
const list = res?.items || [];
setItems((prev) => {
  const seen = new Set(prev.map((x) => x.id));
  return [...prev, ...list.filter((x) => !seen.has(x.id))];
});
if (!list.length || (res?.pagination && p >= res.pagination.pages)) setDone(true);
```

三个防御点：`loadingRef` 防并发、按 `id` 去重合并、`pagination.pages` 判定到底。失败时不是空白页，而是 `Empty` + 重试按钮（`Home.tsx:52-57`）。

### 第 3 步：Feed 预取详情

`src/components/Feed.tsx:334-343`：

```ts
const need = [videoIds[index], videoIds[index + 1], videoIds[index - 1]];
```

三路并行 `api.video(id)`（帖子走 `api.post`）。这是「滑到下一条时详情已经在了」的关键——不是懒加载当前条，而是**当前条 ±1 都预取**。

### 第 4 步：拿播放地址（两级回退）

`src-tauri/src/api.rs:499-528` 的 `api_play`：

1. 先 `POST /api/videos/{id}/episodes/{ep}/playback`；
2. 若返回里没有可用地址（`has_play_url` 为假），回退 `GET /api/videos/{id}/play?ep={ep}&page_texts=0`；
3. 两者都失败则返回第一个的响应（让前端拿到业务错误信息）。

`normalize_play_info`（`src-tauri/src/api.rs:475-491`）负责把新接口的 `streams.{main,hevc}` 回填到旧字段 `video_url` / `video_url_hevc`——**只在旧字段为空时填**，避免覆盖。这是典型的「新旧接口并存期兼容层」。

### 第 5 步：URL 改写进本地协议

前端拿到原始 `video_url` 后：

```ts
// src/api.ts:35-39
cover(url)    → `${LOCAL}/img?u=${encodeURIComponent(url)}`
playlist(url) → `${LOCAL}/hls?u=${encodeURIComponent(url)}`
```

`LOCAL` 在 `src/api.ts:29` 按平台判定，必须与 `media.rs:21-24` 一致。

### 第 6 步：Rust 侧解密与改写

`media::handle(path, query, origin)`（`src-tauri/src/media.rs:354-405`）：

- 从 query 取 `u=` 并解码，空则 400；
- `/img` → `load_image`：命中 `IMG_CACHE` 直接回，否则 `fetch_bytes`，若响应本身已是图片（魔数匹配）就原样返回，否则 AES-128-CBC 解密 + PKCS#7 去填充；
- `/hls` → `load_playlist`：校验 `#EXTM3U` 前缀（容忍 BOM），`rewrite_playlist` 后缓存；
- `/seg` → `load_segment`：先查 `KEY_CACHE` 再查 `SEG_CACHE`，未命中就下载，≤64KB 当密钥、≤4MB 当分片缓存；
- 错误统一 502 `text/plain`。

### 第 7 步：hls.js 播放

`VideoSurface.tsx:184-210` 的配置是本项目最值得抄的一段（详见 [04 深挖](04-deep-dive-media-proxy.md)）。三个「主动关掉」比「打开」更重要：

- `enableInterstitialPlayback: false` + 两个 controller 设为 `undefined`——禁掉 hls.js 从插播/内容引导 JSON 里派生直连 URL 的能力，否则改写过的清单会被绕过；
- `enableWorker: !isIos`——iOS WKWebView 下 Web Worker 跨 `hg://` 高频中断会死锁；
- `preferManagedMediaSource: false`——避开 macOS/iOS 27 的 MMS seek 缓冲 bug。

## 先读的 10 个文件

| 顺序 | 文件 | 为什么读 |
|---|---|---|
| 1 | `src-tauri/src/net.rs`（顶部 20 行注释） | 全项目最有价值的运维知识：代理为什么失效、PAC 为什么不支持、怎么用 `HGHUB_PROXY` 排查 |
| 2 | `src-tauri/src/network_policy.rs` | 394 行里 160 行是测试，看懂它就看懂了「不可信目标」怎么防 |
| 3 | `src-tauri/src/media.rs` | 媒体代理全貌：解密、URI 改写、四组缓存 |
| 4 | `src-tauri/src/lib.rs` | 装配 + 协议注册 + 34 个命令清单，一次看完应用边界 |
| 5 | `src-tauri/src/api.rs` | 业务命令实现，`api_play` 的两级回退最值得看 |
| 6 | `src/components/VideoSurface.tsx` | hls.js 配置与错误恢复，可直接抄的工程经验 |
| 7 | `src/usePlaybackActivity.ts` | 70 行解决「切页面时播放器还在响」 |
| 8 | `src/useSeekInput.ts` | 74 行的「按下预览、松开提交」模型 |
| 9 | `src/components/Feed.tsx`（先读 190-440 行） | 手势与全屏的核心段，后半段是面板与手势细节 |
| 10 | `src/playbackDiagnostics.ts` | 前端诊断队列 + 与 Rust `resource_id` 对齐的哈希 |
| 11 | `src/html.ts` | DOMPurify 双次清洗与图片代理重写 |
| 12 | `docs/security.md` | 作者自己写的加固清单，比代码更好读 |

## 关键类型/函数

### Rust

```rust
// src-tauri/src/net.rs:468
pub async fn edge(origin: &str, method: &str, path: &str,
                  body: Option<Value>, token: Option<&str>) -> Result<Value, String>

// src-tauri/src/net.rs:203
pub async fn get(raw: &str, timeout: Duration,
                 accept: Option<&str>, referer: Option<&str>) -> Result<reqwest::Response, String>

// src-tauri/src/net.rs:617
pub async fn fetch_bytes(url: &str) -> Result<(Option<String>, Vec<u8>), String>

// src-tauri/src/network_policy.rs:194
pub async fn resolve_target(url: &Url, strict: bool) -> Result<Vec<SocketAddr>, String>

// src-tauri/src/network_policy.rs:129
pub fn parse_target_with_mode(raw: &str, strict: bool) -> Result<Url, String>

// src-tauri/src/media.rs:354
pub async fn handle(path: &str, query: &str, origin: &str) -> Response<Vec<u8>>

// src-tauri/src/media.rs:210
fn rewrite_playlist(url: &str, text: &str, prefix: &str) -> String

// src-tauri/src/playback_log.rs:40
pub fn resource_id(raw: &str) -> String   // FNV-1a 32 → "r{hash:08x}"
```

### 前端

```ts
// src/api.ts:46
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T>

// src/api.ts:35-39
cover(url: string): string
playlist(url: string): string

// src/html.ts:134
sanitizeHtml(html: string): string

// src/usePlaybackActivity.ts
usePlaybackActivity(videoRef, hlsRef, { active, autoPlay, src, trace })

// src/useSeekInput.ts
useSeekInput({ time, duration, enabled, resetKey, onInteraction, onSeek })

// src/playbackDiagnostics.ts
usePlayerDiagnostics(videoRef, hlsRef, context)  // → { trace, requestSeek }
observeHls(hls, trace)
mediaResource(raw: string): string
```

## 加一个功能要改哪里

### 例 1：加一个新业务接口（比如「历史记录同步」）

1. `src-tauri/src/net.rs` 的 `edge_operation` 加标签（否则日志里只会记成 `other`）；
2. `src-tauri/src/api.rs` 加 `#[tauri::command]`，用 `self.authed(...)` 走带 token 的路径；
3. `src-tauri/src/lib.rs:133-170` 的 `invoke_handler` 里注册；
4. `src/api.ts` 的 `api` 对象加一行；
5. 若涉及登录态，注意 `net.rs:476-485` 会强制可信 origin——镜像线路下这个接口会直接报错。

### 例 2：加一个新的媒体类型（比如封面视频预览）

1. `src-tauri/src/media.rs:354-405` 的 `handle` 加路由分支；
2. 若需要缓存，在 `media.rs:29-42` 加一组常量；
3. `src/api.ts` 加对应的 URL 构造函数；
4. `src-tauri/src/lib.rs:79-132` 的 `route` 匹配里加日志标签（`/hls` → `playlist` 这类映射）。

### 例 3：改播放器手势

只动 `src/components/Feed.tsx:547-670`（触摸判定）与 `Feed.tsx:672-690`（`touchmove` 拦截）。**不要**动 `VideoSurface.tsx`——它只关心「播」，不关心手势。这条边界如果不守，1329 行会变成 2000 行。

### 例 4：加一个设置项

1. `src/store.tsx` 的 `Persist` 加字段 + `DEFAULTS` 给默认值；
2. `src/pages/Settings.tsx` 加一个 `Section` 内的行；
3. 若需要在 Rust 侧持久化（像 `strict_security` 那样），走 `security_set` 的模式：写 `.tmp` 再 `rename`，失败不改内存态。

## 测试地图

### Rust 单测

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

按 `docs/security.md` 记录：28 passed / 0 failed / 5 ignored。5 个 ignored 都是联网测试（`mirrors_live`、`probe_live`、`live_play_chain`、`cover_decrypt_works`、`diag`）。

各文件测试覆盖：

| 文件 | 测什么 |
|---|---|
| `network_policy.rs:231-393` | 26 个私网/保留地址、IPv6 保留段、`127.1`/`2130706433`/`0x7f000001` 绕过、混合公私网、HTTPS 降级、宽松模式 |
| `net.rs:657-874` | 终端错误不重试、匿名读才跟随重定向、代理凭据脱敏、DNS TTL 不延长、私网 GET 在网络前被拒、非幂等只尝试一次 |
| `media.rs:407-584` | DATERANGE 保留时间线、引号内逗号、嵌套播放列表改写、封面解密往返 |
| `playback_log.rs:262-348` | 关闭后不写但保留旧日志、URL/凭据脱敏、轮转与保存失败 |
| `session.rs:18-50` | 凭据绑定 origin、旧版 session 不分配给当前线路 |
| `api.rs:627-703` | streams 回填、旧字段不被覆盖、前端不能绕过 URL 策略、版本比较 |
| `logging.rs:44-130` | UTC 时间戳、多行记录原子性 |

### 前端浏览器回归

这些测试不是 vitest，是**在浏览器里跑的 HTML 页面**（`tests/*.html` 挂 `tests/*.tsx`）：

```bash
pnpm dev   # 起 :1420
# 然后访问
# http://127.0.0.1:1420/tests/html-security.html    （31 项）
# http://127.0.0.1:1420/tests/player-seek.html      （12 项，需 serve-seek-media.py）
# http://127.0.0.1:1420/tests/security-settings.html（8 项）
# http://127.0.0.1:1420/tests/api-loading.html
```

`player-seek.html` 需要真实 HLS 流：

```bash
ffmpeg -f lavfi -i testsrc=size=640x360:rate=30 -t 90 \
  -c:v libx264 -f hls -hls_time 2 -hls_list_size 0 tests/media/out.m3u8
python tests/serve-seek-media.py
```

### Playwright 脚本

```bash
pnpm test:playback --scenarios seek,legacy,stall,lifecycle,mms
pnpm test:api-loading
```

`scripts/test-playback.mjs`（348 行）用 `playwright-core` 驱动 Chromium，注入 404/503/慢请求验证页面状态；`playback.yml` 在 CI 里跑并上传 `playback-diagnostics` artifact（保留 7 天，`if: always()`）。

### 构建期检查

```bash
pnpm build   # = tsc --noEmit && tsc --project tsconfig.tests.json && vite build
```

注意它**同时检查 src 与 tests**。`tsconfig.tests.json` 用 ES2022 是为了让回归代码能用顶层 await（`docs/review-followup.md` 的 P3-4）。

**一句话记住：** 先读 `net.rs` 顶部注释和 `network_policy.rs` 的测试，再读 `media.rs` 的 `rewrite_playlist`——这三处读懂了，剩下的 1300 行 Feed.tsx 只是手感问题。
