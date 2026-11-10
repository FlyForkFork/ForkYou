# 09 运维：装不上、打不开、播不动怎么排

> 这篇回答：装完不能用时按什么顺序排查、数据落在哪、怎么回滚。

## 安装

| 平台 | 产物 | 注意 |
|---|---|---|
| Windows | NSIS 安装包 / 便携 zip | 未签名，SmartScreen 会拦，需「更多信息 → 仍要运行」 |
| macOS | universal dmg | ad-hoc 签名（`signingIdentity: "-"`），首次需右键 → 打开，或 `xattr -dr com.apple.quarantine` |
| Linux | deb / AppImage | 需 WebKitGTK 4.1 |
| Android | split-per-abi APK（arm64 / armv7 / x86_64） | 自行选择 ABI，装错会闪退 |

macOS 没有公证（notarization），这是 `tauri.macos.conf.json` 里 `signingIdentity: "-"` 的直接后果。**这不是 bug**，作者选择的是「不给 Apple 交年费」的路线。

## 数据落在哪

所有运行时状态都在 Tauri 的 `app_data_dir` 下，identifier 是 `com.hghub.huangguo`：

| 平台 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/com.hghub.huangguo/` |
| Windows | `%APPDATA%\com.hghub.huangguo\` |
| Linux | `~/.local/share/com.hghub.huangguo/` |
| Android | 应用私有目录 |

目录里的文件：

| 文件 | 内容 | 谁写 |
|---|---|---|
| `security.json` | 严格模式开关（**安全设置的唯一真源**） | `network_policy::set_strict_security` |
| `line.json` | 当前线路 base URL | `net::set_base` |
| `session.json` | 登录态（origin + token + user） | `session::persist` |
| `debug.log` | 调试日志（UTC 时间戳，多行原子写） | `logging::append_debug` |
| `playback.log` | 播放诊断日志（JSON Lines，2MB 轮转） | `playback_log::Journal::append` |
| `playback.previous.log` | 上一轮日志 | 轮转产生 |
| `playback-diagnostics.json` | 诊断开关状态 | `playback_log::set` |

前端状态（收藏、观看记录、搜索历史、主题、音量）在 **localStorage** 的 `hghub_app_v1` / `hghub_theme` 键里（`src/store.tsx`），不在上面这些文件里。

这个分工很重要：**安全偏好与登录态在 Rust 侧，UI 偏好在 WebView 侧**。清 localStorage 不会丢登录，删 `security.json` 会回到默认严格模式。

## 排障：打不开

按这个顺序，别跳步。

### 第 1 步：先看是「网络」还是「策略」

打开 设置 → 网络 → **网络诊断**（`src/pages/Settings.tsx` 里的按钮，调 `api.netDiag()`）。它输出 `net::diagnose()` 的结果（`src-tauri/src/net.rs:332-378`）：

```json
{
  "base": "https://huangguoai.com",
  "host": "huangguoai.com",
  "dns": { "count": 2, "has_fake_ip": false },
  "http": { "status": 200, "ms": 342 },
  "env": {
    "HTTP_PROXY": "[已配置，原始值已隐藏]",
    "NO_PROXY": "[已配置，列表已隐藏]",
    "HGHUB_PROXY": null
  }
}
```

读法：

- `dns.count == 0` → DNS 解析失败。检查系统 DNS / hosts / 代理软件是否在拦截。
- `dns.has_fake_ip == true` → 解析到 `198.18.x` / `198.19.x`，说明开了 Clash/Mihomo 的 FakeIP。**这是允许的**（`network_policy.rs:91-123` 显式放行），但如果后续失败，问题在代理而不是策略。
- `http.status == 200` 但业务接口 404 → **首页可达不等于业务网关正常**。`docs/playback-investigation-20261108.md` 明确写了这点。
- `env.HTTP_PROXY` 有值但 `http.status` 失败 → 代理配置有问题。

### 第 2 步：代理不生效（最常见的坑）

`net.rs:1-20` 的注释列了四种情况，逐条对照：

| 症状 | 原因 | 解法 |
|---|---|---|
| 浏览器能开官网，HGhub 打不开 | reqwest 没开 `system-proxy`（本项目已开，但如果你自己编译时删了 features 就会这样） | 确认 `Cargo.toml` 里 `system-proxy` 在 features 列表 |
| 设了 PAC 但没用 | reqwest **不支持 PAC**（AutoConfigURL），只认固定代理 | 改成固定代理，或设 `HGHUB_PROXY` |
| Android 上系统 Wi-Fi 代理无效 | Android 没有注册表，reqwest 读不到系统代理 | 用 VPN/TUN 模式（Clash 的 TUN、Surge 的增强模式） |
| 代理软件开关后一直 tunnel error | reqwest 连接池里的旧连接卡住 | 客户端有 `heal_client` 3 秒节流自愈（`net.rs:275-295`），等 3 秒或重启 |

**万能解法**：设环境变量强制代理。

```bash
HGHUB_PROXY=http://127.0.0.1:7897 ./HGhub
```

`proxy_override()`（`src-tauri/src/net.rs:116-121`）会读它，且错误信息里不会泄露原始代理 URL（只回 `scheme://host:port`）。

### 第 3 步：严格模式误杀

如果诊断显示 DNS 正常、HTTP 也通，但业务请求全部失败，试试关掉严格模式：

```bash
HGhub --no-strict
# 或
HGHUB_STRICT=0 HGhub
```

三种关闭方式（`network_policy.rs:14-36`）：命令行 `--no-strict` / `--no-strict-security` / `--relaxed` / `--relaxed-security`，环境变量 `HGHUB_STRICT=0|false`，或设置页开关。

关掉后同时失效的防护：私网拦截、HTTPS 降级拦截、导航守卫、`hg` 协议 Origin 校验。设置页会显示「已由启动参数 --no-strict 切换为兼容模式；可手动重新开启」。

**已知会误杀的场景**（`docs/security.md` P2-3）：NAT64/DNS64 合成地址（`64:ff9b::/96`）。IPv6-only + DNS64 的运营商下，严格模式会让客户端完全不可用。这时只能 `--no-strict`。

另一个会误杀的：**DNS 返回混合公私网地址**。`check_addresses_with_mode`（`network_policy.rs:174-185`）的策略是「混合答案整体拒绝」，不是「只用公网那个」。这是保守选择——防止 DNS 投毒把请求引到内网。

### 第 4 步：换线路

设置 → 网络 → 线路（`LinePicker`）。两个固定线路：

- 固定线路 1：`https://huangguoai.com`（默认）
- 固定线路 2：`https://huangguoai.ai`

还有动态发现的镜像（`lines.rs::mirrors()`，上限 60 条）。但记住：

- **镜像线路不能登录**（`net.rs:476-485` 强制可信 origin），会报「镜像线路仅供游客浏览；登录/注册请切换到固定线路」。
- 镜像来自发布页 `https://huangguoai.pages.dev/` 的 `publish.js`，作者自己记录了「发布页在线核对返回 HTTP 403」，所以镜像发现可能整体失效。
- 换线路会清空 session（`api.rs:70-78`），要重新登录。

## 排障：播不动

### 第 1 步：开播放诊断

设置 → 播放诊断 → 打开开关。日志写到 `playback.log`，复现问题后点「复制播放诊断日志」。

日志格式是 JSON Lines，每行：

```json
{"ts":"2026-11-08T13:44:09.656Z","pid":1234,"seq":88,"event":"seek.request","strict":true,"data":{...}}
```

关联四个字段：`pid` + `session` + `player` + `seek`。`docs/playback-diagnostics.md` 给了完整事件表。

### 第 2 步：按症状定位

| 症状 | 先看什么 | 常见原因 |
|---|---|---|
| 黑屏但进度条在走 | `hlsFragLoaded` 有、`hlsFragBuffered` 无 | 分片解码失败，看 `ERROR` 事件的 `details` |
| 一直转圈 | `network.begin` 有、`network.end` 无 | 分片下载卡住，看 `elapsed_ms` |
| 起播慢 | `media.seeking` → `seek.resumed` 的间隔 | 分片下载耗时（见 [05](05-performance.md)） |
| 声音没了 | `MEDIA_ERROR` + `swapAudioCodec` | 音频轨不兼容，播放器第 2 次 MEDIA_ERROR 会 swap |
| 播放中突然停 | `player.heartbeat` 断了 | 页面失活，`usePlaybackActivity` 主动 pause 了 |
| 封面全裂 | 控制台无报错、网络面板看不到 `hg://` 请求 | `LOCAL_ORIGIN` 平台判断错了（`api.ts:29` vs `media.rs:21-24`） |
| 只有 iOS 卡 | `enableWorker` | iOS WKWebView 下 Web Worker 跨 `hg://` 会死锁，代码已关（`VideoSurface.tsx:184-210`） |

### 第 3 步：清缓存

设置 → 本地数据 → 清理缓存。它调 `api.clearCache()` → `api.rs:592-596` → `media::clear_caches()`，只清四组内存缓存（封面、清单、key、分片），**不动收藏/历史/登录**。

如果怀疑是缓存里的坏数据（比如某次请求拿到了错误页被缓存），这是唯一的清理入口。

### 第 4 步：确认不是上游问题

用 `curl` 直接打业务信封（需要自己抓一个有效请求体）：

```bash
curl -X POST https://huangguoai.com/api/edge/request \
  -H 'Content-Type: application/json' \
  -H 'Referer: https://huangguoai.com/' \
  -d '{"method":"GET","path":"/api/feed?page=1","body":null,"content_type":""}'
```

如果这也失败，客户端无能为力——作者已声明不跟进上游。

## 回滚

### 降级到旧版本

直接从 [Releases](https://github.com/Minireel/HGhub/releases) 装旧版即可。注意 **v1.0.1 及更早是 MIT 授权，v1.1.0 起是 PolyForm Noncommercial**——如果你要基于旧版做二次开发，授权状态不同。

### 重置到干净状态

按影响范围从小到大：

```bash
# 1. 只清播放日志
rm ~/Library/Application\ Support/com.hghub.huangguo/playback.log

# 2. 重置安全模式为默认（严格）
rm ~/Library/Application\ Support/com.hghub.huangguo/security.json

# 3. 重置线路
rm ~/Library/Application\ Support/com.hghub.huangguo/line.json

# 4. 强制重新登录
rm ~/Library/Application\ Support/com.hghub.huangguo/session.json

# 5. 全部重置（含前端状态）
rm -rf ~/Library/Application\ Support/com.hghub.huangguo/
# 再在应用内 DevTools 执行 localStorage.clear()
```

Windows 路径把 `~/Library/Application Support/` 换成 `%APPDATA%\`。

### 升级后必须重新登录的情况

`session.rs:9` 的注释说明了：**旧版本的 session 没有 `origin` 字段，无法推断 token 属于哪个镜像，升级后必须重新登录。** 这是有意的安全设计，不是 bug。

## 网络分流规则

`rules/` 目录提供 Mihomo / Sing-box 的规则文件（`hghub.json` / `hghub.list` / `hghub.srs`）。`rules/README.md` 说明得很清楚：

> 这是一份源码已知目标清单，不是完整流量白名单。（`rules/README.md`）

包含的目标：`huangguoai.com`、`huangguoai.ai`（业务）、`drleao.cn`（图片 CDN）、`hzjvlo.cn`（视频 CDN）、`xxbgwypx.cc`（镜像）、`huangguoai.pages.dev`（发布页）、`api.github.com` + `github.com`（更新检查）。

**用法建议**：把业务域名走代理，视频 CDN 直连（省流量）。但注意规则里的域名可能随上游变化，作者已声明不跟进。

## 关键运维常量速查

| 项 | 值 | 位置 |
|---|---|---|
| 播放日志单文件上限 | 2 MiB | `src-tauri/src/playback_log.rs:11` |
| 播放日志轮转份数 | 2（current + previous） | 同上 |
| 单批日志条数上限 | 128 | `src-tauri/src/playback_log.rs:219-243` |
| 单条 data 上限 | 8192 字符 | 同上 |
| event 名允许字符 | ascii alnum + `._-`，≤80 | 同上 |
| 客户端缓存 TTL | 30 s | `src-tauri/src/net.rs:151` |
| 客户端缓存上限 | 64 条 | `src-tauri/src/net.rs:164-194` |
| HTTP 超时 | 20 s | `src-tauri/src/net.rs:128-149` |
| 重试次数 | 3，退避 350ms×n | `src-tauri/src/net.rs:403-426` |
| 重定向跳数上限 | 5 | `src-tauri/src/net.rs:203-245` |
| 镜像数量上限 | 60 | `src-tauri/src/lines.rs:16` |
| 线路探测并发 | 6 | `src-tauri/src/lines.rs:72-87` |
| 分片缓存单条上限 | 4 MB | `src-tauri/src/media.rs:29-42` |

**一句话记住：** 排障顺序永远是「网络诊断看 DNS/代理 → 确认不是代理不生效 → 试关严格模式 → 换线路」；90% 的「打不开」是 reqwest 的代理语义与浏览器不同，而不是代码坏了。
