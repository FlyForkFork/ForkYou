# 04 深挖：媒体代理层

> 这篇回答：为什么一个第三方客户端要在 Rust 里重写一遍 HLS 的取流逻辑，以及那 585 行到底解决了什么。

## 问题

HGhub 的前端是一个 WebView。它要播的流来自 `huangguoai.com` 的 CDN，形态是标准的 HLS：一个主清单、若干子清单、分片、AES-128 密钥。看起来 `hls.js` 直接就能播。

实际不行，卡在四道门：

1. **CORS**。分片和 key 在另一个域名（`hzjvlo.cn`，见 `rules/README.md`），响应不带 `Access-Control-Allow-Origin`。WebView 里的 `fetch`/XHR 直接被浏览器拦掉。
2. **防盗链**。清单和分片检查 `Referer`，空 Referer 或非站点 Referer 会 403。
3. **封面是密文**。站点把封面图做了 AES-128-CBC 加密，直接当图片 `<img>` 用是黑图。
4. **清单里有直连陷阱**。`#EXT-X-CONTENT-STEERING` 和插播广告的 JSON 会让 hls.js 自己去派生「另一条播放路径」，那条路径不经过我们的改写。

`media.rs` 顶部 5 行注释是作者的原话：

> 站点封面 AES-128-CBC 密文，m3u8 分片/key 被 WebView CORS 拦，统一走本地自定义协议。（`src-tauri/src/media.rs:1-5`）

## 朴素做法为什么不够

**做法 A：给 `hls.js` 配 `xhrSetup` 加 header。** 只能加请求头，改不了 CORS 的响应判定——CORS 是浏览器在**收到响应后**根据响应头决定的，客户端加什么都不管用。

**做法 B：用 Tauri 的 HTTP 插件（`tauri-plugin-http`）。** 确实能绕过 CORS，但返回的是「一个完整响应」，而 `hls.js` 要的是能塞进 `MediaSource` 的流式分片；而且清单里的相对 URI 仍指向上游，`hls.js` 照样会去直连。

**做法 C：起一个本地 HTTP 服务器。** 可行，但要多开端口、处理冲突、在应用退出与移动端后台被杀时清理。成本远高于收益。

**做法 D：自定义协议。** `register_asynchronous_uri_scheme_protocol` 让 `hg://localhost/...` 的请求在进程内被拦截并异步返回响应。对 WebView 是同源资源，CORS 消失；对 `hls.js` 是普通的相对 URL，改写后的清单里所有 URI 都指向它。项目选了这个。

## 这个项目怎么做

### 一层：URL 改写（前端）

```ts
// src/api.ts:35-39
cover(url)    → `${LOCAL}/img?u=${encodeURIComponent(url)}`
playlist(url) → `${LOCAL}/hls?u=${encodeURIComponent(url)}`
```

`LOCAL` 按平台判定（`src/api.ts:29`）：macOS/iOS/Linux 是 `hg://localhost`，Windows/Android 是 `http://hg.localhost`。为什么要区分？因为 Windows 的 WebView2 需要 `http://<scheme>.localhost` 形式才把请求当作安全上下文，否则 `MediaSource` 等 API 被禁用。搞错的症状是「封面全裂、播放器初始化失败，但没有任何报错」。

### 二层：协议注册与 Origin 校验（Rust）

```rust
// src-tauri/src/lib.rs:79-132（要点）
app.register_asynchronous_uri_scheme_protocol("hg", move |_app, request, responder| {
    // 1. 读 Origin 头
    // 2. playback_log 记 protocol.request（route/resource/status/bytes/elapsed_ms）
    // 3. strict 且 Origin 非应用来源 → 403 "origin denied" + security.origin_denied
    // 4. 否则 spawn media::handle(&path, &query, LOCAL_ORIGIN)
    // 5. 回填 ACAO：有 Origin 就回显 + Vary: Origin，否则 *
});
```

注意第 5 步的分支：**有 Origin 才回显并加 `Vary: Origin`**。这是正确的缓存语义——如果无脑回 `*`，中间缓存可能把一个用户的响应给另一个 Origin 用。

`Range` 头的校验也在这层：长度 ≤100 且只允许数字、`bytes=`、`-`、`,`、空格。这是防止有人用超长 Range 头做注入或 DoS。

### 三层：封面解密

```rust
// src-tauri/src/media.rs:26-27
const IMG_KEY: &[u8] = b"f5d965df75336270";
const IMG_IV:  &[u8] = b"97b60394abc2fbe1";
```

16 字节 key + 16 字节 IV，硬编码在源码里。这个 key 是从站点前端 JS 里提取出来的（推断：因为它是前端解密逻辑的必然产物，任何能看封面的人都拿得到）。所以它不是秘密，但它是**必需**的——不写死就得每次运行时去抓。

解密流程（`src-tauri/src/media.rs:56-123`）：

```rust
fn aes_cbc_decrypt(data: &[u8], key: &[u8], iv: &[u8]) -> Vec<u8>  // 手写 CBC 链式异或
fn strip_padding(data: &[u8]) -> &[u8]                             // PKCS#7
fn image_kind(data: &[u8]) -> Option<&'static str>                 // 魔数识别 jpeg/png/gif/webp

async fn load_image(url: &str) -> Response {
    if let Some(hit) = cache_get(IMG_CACHE, url) { return hit; }
    let (bytes, ctype) = fetch_bytes(url).await?;
    let bytes = if image_kind(&bytes).is_some() { bytes } else { decrypt(bytes) };
    ...
}
```

`image_kind` 的判断很重要：**不是所有封面都加密**。新上传的可能就是明文 JPEG。先按魔数探一下，是图片就原样返回，否则才解密。这是「防御性兼容」而不是「假设上游一致」。

### 四层：m3u8 全 URI 改写（核心）

这是整个媒体层最精妙的部分。`rewrite_playlist`（`src-tauri/src/media.rs:210-256`）做四件事：

**① 丢弃内容引导**

```rust
// 丢掉 #EXT-X-CONTENT-STEERING
```

`#EXT-X-CONTENT-STEERING` 是 HLS 的内容引导标签，它指向一个 JSON，里面可能包含**另一组 CDN 地址**。如果保留，hls.js 会去请求那个 JSON 并切换到未经我们改写的直连地址——CORS 立刻失败，而且日志里看不出原因。

**② DATERANGE 保留元数据、删掉 URL**

```rust
// DATERANGE 保留时间线 / SCTE-35，过滤含 URI / X-ASSET-LIST 的属性
```

`#EXT-X-DATERANGE` 用于标记广告插入点（SCTE-35）。如果整行删掉，时间线会错乱；如果整行保留，里面的 `X-ASSET-URI` 会让播放器去拉广告资源。所以项目做了**属性级过滤**：留下 `START-DATE`、`DURATION`、`SCTE35-OUT` 等，删掉 `URI` 和 `X-ASSET-LIST`。

对应测试：`dateranges_keep_timing_and_scte_metadata_but_drop_external_resources`（`src-tauri/src/media.rs:407-584`）。

**③ 所有含 `URI="` 的行都改写**

不是只改 `#EXT-X-KEY`。项目覆盖了：

| 标签 | 用途 | 漏改的后果 |
|---|---|---|
| `#EXT-X-KEY:URI=` | 解密密钥 | 播放器直连拿 key，CORS 失败，黑屏 |
| `#EXT-X-MAP:URI=` | fMP4 初始化段 | 直连失败，无法初始化解码器 |
| `#EXT-X-MEDIA:URI=` | 备用音轨/字幕 | 切音轨时静默失败 |
| `#EXT-X-SESSION-KEY:URI=` | 跨清单的密钥 | 切码率后黑屏 |
| `#EXT-X-PART:URI=` | 低延迟分片 | LL-HLS 下卡住 |
| `#EXT-X-PRELOAD-HINT:URI=` | 预加载提示 | 预取失败，起播变慢 |

对应测试：`every_uri_attribute_is_rewritten_without_splitting_quoted_commas`（同上）。

**④ 普通行改写成 `/seg?u=`**

非 `#` 开头的行就是分片地址，统一改写成 `{prefix}/seg?u={绝对化后的URL}`。

改写前要先**绝对化**——清单里的 URI 可能是相对的（`seg1.ts`），必须基于清单自身的 URL 解析成绝对地址，否则 `u=` 里放一个相对路径，Rust 侧拿到后不知道相对谁。

**一个容易被忽略的坑**：属性值里可能有逗号，而且是引号内的逗号：

```
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English, US",URI="a.m3u8"
```

如果按逗号简单 split，`NAME` 会被切成 `"English` 和 ` US"`。所以项目写了 `hls_attributes`（`src-tauri/src/media.rs:148-164`）专门处理引号内的逗号。

### 五层：子清单也要改写

`/seg` 路径拿到的内容**不一定**是分片。HLS 的主清单里，`#EXT-X-STREAM-INF` 后面跟的是**子清单 URL**。如果 `rewrite_playlist` 把子清单也改写成 `/seg?u=`，那么 `/seg` 返回的就是一个 m3u8 文件。

所以 `segment_response`（`src-tauri/src/media.rs:316-348`）做了二次识别：

```rust
// 内容看起来是 playlist（ctype 含 mpegurl 或 #EXTM3U/BOM）则继续改写
// 否则原样返回
```

对应测试：`nested_playlists_and_alternate_uris_stay_behind_proxy`——断言响应里有 4 个 `/seg?u=` 且**没有** `Access-Control-Allow-Origin` 头（因为这条路径不走协议的 ACAO 回填）。

### 六层：缓存

四组进程内缓存（`src-tauri/src/media.rs:29-42`）：

| 缓存 | 容量 | 单位 | 失效 |
|---|---|---|---|
| `IMG_CACHE` | 240 | 条目 | 进程退出 |
| `PL_CACHE` | 60 | 条目 | 进程退出 |
| `KEY_CACHE` | 120 | 条目 | 进程退出 |
| `SEG_CACHE` | 36 | 条目 + 4MB 上限 | 进程退出 |

淘汰策略是 `cache_put` 满时「任意删一个 key」（`src-tauri/src/media.rs:44-52`），**不是 LRU**。这是有意为之的简化——LRU 需要维护访问顺序，而对 36 条分片缓存来说，随机淘汰的命中率差别很小。`docs/media-cache-audit-20261108.md` 专门审计过这点，结论是「未改成更小容量或更短 TTL」。

HTTP 缓存指令分三档（`src-tauri/src/media.rs:301-348`）：

- `/img` → `public, max-age=86400`（封面一天，合理）
- `/hls` → `no-store`（主清单不缓存，但 Rust 内存里缓存 60 条）
- `/seg` → `public, max-age=3600`（分片一小时）

`/hls` 的 `no-store` 与内存缓存并存看起来矛盾，其实是两个层次：`no-store` 是告诉 WebView 别缓存（因为清单会变），内存缓存是 Rust 侧的优化（避免同一清单被请求两次时重复下载）。`docs/media-cache-audit-20261108.md` 明确解释了这一点。

## 代码证据

```rust
// src-tauri/src/media.rs:195-208
async fn load_playlist(url: &str) -> Response {
    // 校验 #EXTM3U 前缀（容忍 BOM）
    // rewrite_playlist 后缓存
}

// src-tauri/src/media.rs:354-405
pub async fn handle(path: &str, query: &str, origin: &str) -> Response {
    // 从 query 取 u= 解码，空 → 400
    // /img | /hls | /seg 路由
    // 错误统一 502 text/plain
    // 记 proxy.begin / proxy.end
}
```

## 复杂度/性能/边界

**复杂度**：清单改写是 O(行数)，每行最多一次 URL 解析。一个典型主清单 20~40 行、子清单几百行，开销可忽略。封面解密是 O(字节数)，AES-128-CBC 在 Rust 里约几百 MB/s，一张 200KB 封面不到 1ms。

**边界一：4MB 分片上限**。`SEG_CACHE_MAX_BYTES = 4MB`，超过就不进缓存（但仍会正常返回）。短剧的 2 秒分片通常 500KB~2MB，够用。如果上游改成 10 秒分片或 4K，缓存会全面失效。

**边界二：`#EXT-X-MAP` 的 fMP4**。项目改写了 `URI=`，但没有专门处理 fMP4 的 `BYTERANGE`。如果上游用字节范围请求同一个 init 段，可能会有重复下载（推断：未在代码中找到显式的 byterange 缓存合并逻辑）。

**边界三：`docs/security.md` 记录的 P2-3**。严格模式拒绝 NAT64/DNS64 合成地址（`64:ff9b::/96`），IPv6-only + DNS64 的运营商下客户端可能完全不可用。这是媒体层的**前置**问题——连不上就没有代理可言。

**边界四：媒体代理是「先完整下载再返回」**。`docs/playback-investigation-20261108.md` 明确写：「媒体代理目前先接收完整分片再返回给 WebView，因此 HLS 的首字节耗时包含 Rust 下载完整分片的等待」。这意味着没有流式转发，起播延迟 = 分片完整下载时间。

## 取舍与局限

| 取舍 | 得到 | 失去 |
|---|---|---|
| 自定义协议而非本地 HTTP 服务 | 零端口、零冲突、移动端友好 | 无法被 curl/ffmpeg 复用；调试只能靠日志 |
| 手写 m3u8 解析 | 零依赖、精确控制标签 | 边界靠测试兜，新标签出现时要手动跟进 |
| 硬编码 AES key | 无需运行时抓取 | 上游换 key 就要发版 |
| 内存缓存 + 随机淘汰 | 实现简单 | 命中率不如 LRU，大分片场景退化明显 |
| 先下载完再返回 | 实现简单、能算 `Content-Length` | 无流式，起播慢 |

## 我能偷什么

1. **`register_asynchronous_uri_scheme_protocol` 是绕过 WebView CORS 的最干净方案**。比本地 HTTP 服务少一个端口、少一套生命周期管理。只要你的 Tauri 应用需要拉跨域媒体/图片，这就是首选。

2. **改写清单要穷举所有 `URI="` 属性**。只改分片行是不够的，key/map/media/session-key/part/preload-hint 漏一个就是黑屏或静音。写测试时逐个标签断言。

3. **主动禁用会派生直连的库特性**。hls.js 的 `interstitialsController` / `contentSteeringController` / `enableInterstitialPlayback` 默认可能开启，一旦开启就会绕过你的改写。关掉它们比事后排查便宜得多。

4. **先按魔数判断再解密**。`image_kind` 那一行让「新上传的明文封面」和「老的加密封面」共存，不需要上游配合。

5. **`Vary: Origin` 别忘**。回显 Origin 的 ACAO 必须配 `Vary: Origin`，否则缓存会串。

**一句话记住：** 媒体代理的本质不是「转发」，而是**把所有可能绕过你的出口都堵上**——清单里的每个 URI、库的每个自动派生特性、每个响应头的缓存语义。
