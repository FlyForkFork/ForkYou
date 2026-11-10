# 07 贡献：跑起来、测起来、提 PR

> 这篇回答：一个新人怎么从 0 到第一个 PR，以及这个项目的 PR 会被什么卡住。

## 环境要求

| 项 | 版本 | 出处 |
|---|---|---|
| Node | 22 | `README.md`；`release.yml` 用 Node 22 |
| pnpm | 10 | `README.md`；`release.yml` 用 pnpm 10 |
| Rust | ≥ 1.90 | `src-tauri/Cargo.toml` 的 `rust-version` |
| Tauri CLI | 2.10.1（devDependency） | `package.json` |
| 平台依赖 | Linux 需 WebKitGTK；Windows 需 WebView2；Android 需 NDK 28.2.13676358 | `release.yml` |

Linux 上还要装 Tauri 2 的标准依赖（WebKitGTK 4.1、libappindicator 等）。项目没有写进 README，需要照 Tauri 官方文档来。

**exFAT 磁盘的特殊处理**：`pnpm-workspace.yaml` 和 `.npmrc` 都固化了 `node-linker=hoisted`。注释解释了原因：exFAT 不支持符号链接，pnpm 默认的 symlink 布局会报 `ERR_PNPM_EISDIR`。这是 Windows 外置盘/双系统用户的必踩坑。

## 构建/运行

```bash
pnpm install --frozen-lockfile

# 只跑前端（浏览器里调 UI，invoke 会全部失败）
pnpm dev            # vite :1420

# 跑完整 Tauri 窗口（推荐）
pnpm app:dev

# 生产构建
pnpm build          # = tsc --noEmit && tsc --project tsconfig.tests.json && vite build
pnpm app:build      # Tauri 打包
```

移动端：

```bash
pnpm android:init    # 首次初始化 Android 工程
pnpm android:icons   # 同步图标
pnpm android:dev     # 真机/模拟器调试
pnpm android:build   # 出 APK
```

iOS 需要 Xcode，且 `tauri.ios.conf.json` 里写死了 `developmentTeam: "ABCDE12345"`（占位值），本地构建要改成自己的 team id。

### 版本号的唯一真源

`vite.config.ts` 里 `__APP_VERSION__` 从 `package.json` 读，注释写明「版本号只维护 package.json，CI 按 tag 改写」。但 `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 里也各有一份 version——`release.yml` 的每个 job 首步会同时改这三处：

```bash
V="${GITHUB_REF_NAME#v}"
# node -e 同时改 tauri.conf.json 与 package.json 的 version
```

所以**手动改版本号要改三处**，或者干脆不改、等 CI 按 tag 覆盖。

## 测试/lint

项目**没有** ESLint / Prettier / Vitest。检查全靠三类：

### 1. 类型检查（构建期）

```bash
pnpm build
```

`tsc --noEmit` 检查 `src`，`tsc --project tsconfig.tests.json` 检查 `tests`。后者用 ES2022 是为了支持回归代码的顶层 await（`docs/review-followup.md` P3-4）。

### 2. Rust 单测

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

按 `docs/security.md`：28 passed / 0 failed / 5 ignored。5 个 ignored 都需要真实网络：

| 测试 | 需要什么 |
|---|---|
| `mirrors_live` | 真实发布页 |
| `probe_live` | 真实镜像 |
| `live_play_chain` | 真实播放链路 |
| `cover_decrypt_works` | `HGHUB_TEST_COVER_URL` 环境变量 |
| `diag` | 真实网络 |

注意 `docs/security.md` 记录过：`mirrors_live`、`live_play_chain` 在严格模式下会因为 DNS 解析到私网被拒而失败，`playlist_rewrite_works` 因旧地址 403 失败。**这不是代码 bug，是策略按设计工作**。

### 3. 浏览器内回归

不是自动化框架，是手动打开的 HTML 页面：

```bash
pnpm dev
```

| 页面 | 项数 | 覆盖 |
|---|---|---|
| `http://127.0.0.1:1420/tests/html-security.html` | 31 | DOMPurify 清洗、图片代理重写、私网 URL 拦截 |
| `http://127.0.0.1:1420/tests/security-settings.html` | 8 | 严格模式初始化、保存失败、状态一致性、已打开文章刷新 |
| `http://127.0.0.1:1420/tests/player-seek.html` | 12 | seek 提交模型（需真实 HLS） |
| `http://127.0.0.1:1420/tests/api-loading.html` | — | 首页 404、频道 503、慢请求 |

`player-seek.html` 需要先造流：

```bash
ffmpeg -f lavfi -i testsrc=size=640x360:rate=30 -t 90 \
  -c:v libx264 -f hls -hls_time 2 -hls_list_size 0 tests/media/out.m3u8
python tests/serve-seek-media.py
```

### 4. Playwright 脚本

```bash
pnpm test:playback --scenarios seek,legacy,stall,lifecycle,mms
pnpm test:api-loading
```

`scripts/test-playback.mjs`（348 行）驱动 Chromium 跑真实播放场景，输出到 `test-results/playback-*/`。`playback.yml` 在 CI 里跑这个并上传 artifact（保留 7 天，`if: always()`）。

## CI 矩阵

五条 workflow：

| Workflow | 触发 | Runner | 做什么 |
|---|---|---|---|
| `release.yml` | tag `v*` / 手动 | windows-latest、macos-latest、ubuntu-latest | 三平台打包 + 建 Release |
| `build-ios.yml` | 手动 / push main & tags | macos-latest | `tauri ios init --ci` + 注入旋转配置 |
| `build-macos.yml` | （未细读，147 行） | macos-latest | macOS 构建 |
| `build-linux.yml` | （未细读，58 行） | ubuntu | Linux 构建 |
| `playback.yml` | 手动（可传 scenarios） | ubuntu-24.04 | Playwright 播放回归 + artifact |

`release.yml` 的细节值得看：

- **Windows**：NSIS 安装包 + 便携 zip。
- **macOS**：`universal-apple-darwin` + dmg，签名 `"-"`（ad-hoc，用户需右键打开绕过 Gatekeeper）。
- **Android**：手动装 SDK `platform-36` / `build-tools 36.0.0` / `ndk 28.2.13676358`；targets `aarch64-linux-android`、`armv7-linux-androideabi`、`x86_64-linux-android`；`split-per-abi` 出三个 APK；`apksigner --v4-signing-enabled false`；keystore 用完 `rm -f`。
- **签名 secrets**：`ANDROID_KEY_BASE64`、`ANDROID_KEY_ALIAS`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_PASSWORD`。
- 每个 job 都先做「版本号对齐 tag」，再构建。所以**打 tag 就是发版**，不要随便打 `v*` tag。

`build-ios.yml` 的一个巧思：`pnpm tauri ios init --ci` 生成 Xcode 工程后，用 `PlistBuddy` 往 `Info.plist` 注入 `UISupportedInterfaceOrientations`（iPhone 与 iPad 两套）。因为 `tauri ios init` 生成的默认配置不含横屏，而 Feed 需要横屏全屏。

## 提交 PR 会被什么卡住

按 RULES 的证据要求，这里只写能从代码/文档确认的：

### 1. 新增网络请求必须走策略

`network_policy.rs` 是唯一的目标校验入口。任何新增的 `reqwest` 调用如果不经过 `parse_target` / `resolve_target`，在严格模式下会被视为绕过。`net.rs:657-874` 的测试里有 `private_get_is_rejected_before_network` 和 `untrusted_origins_reject_credentials_before_network` 两个断言守着这条线。

### 2. 前端不能拿到 opener 权限

`capabilities/default.json` 刻意不含 `opener:*`。`api.rs:657-670` 有一个测试专门读这个文件断言：

```rust
// frontend_cannot_bypass_url_policy_with_opener_commands
// 读 capabilities/default.json，断言没有 opener:*
```

加任何 capability 都可能触发这个测试失败。这是有意的：外链必须走 `open_url` 命令（先 `parse_target` 校验），不能由前端直接调插件。

### 3. 日志不能落 URL

`playback_log.rs:71-114` 的 `scrub` 会把任何含 `://` 或 `%3a` 的字符串替换成 `[redacted]`，key 名含 `url`/`token`/`password`/`cookie`/`authorization`/`body`/`message`/`reason` 的直接丢弃。想在日志里加字段，必须确认不含这些。

### 4. 媒体清单改写要覆盖所有 URI 属性

`media.rs:407-584` 的测试 `every_uri_attribute_is_rewritten_without_splitting_quoted_commas` 会检查。如果新增一种标签（比如 HLS 规范更新加了新标签），要同步改 `rewrite_playlist` 和这个测试。

### 5. 安全设置不能存前端

`docs/review-followup.md` 的 P2-4 明确：「移除 localStorage 安全偏好。Rust `security.json` 是持久化真源，前端启动默认严格，收到 `app_boot` 后同步。」任何在前端存安全偏好的 PR 都会被这条否掉。

### 6. 非商业条款

LICENSE 是 PolyForm Noncommercial 1.0.0。PR 不能引入商业化功能（内购、广告、VIP 解锁），也不能引入与商业使用冲突的依赖许可。

## 提 PR 的实操建议

1. **先确认改动属于哪个维护范围**。README 声明只维护 UI/UX，所以「修上游接口」的 PR 大概率不被接受，「改手势手感」「修播放器 bug」的 PR 更受欢迎。
2. **改 Rust 就带测试**。这个仓库的 Rust 侧测试密度很高（`network_policy.rs` 394 行里 160 行是测试），不带测试的改动会显得突兀。
3. **改前端不要只靠 `pnpm build`**。类型检查过了不代表 UI 对，至少跑一遍 `pnpm test:api-loading`。
4. **涉及播放的改动必须实测**。`docs/playback-seek.md` 记录过一个「点击进度条误暂停」的 bug，根因是 `pointer-events: none` 与 React 更新时序的竞态——这类问题类型系统完全看不出来。
5. **不要动 `_forkyou` 或分析产物**（如果你是在 ForkYou 工作区里读这段）。

## 已知的贡献壁垒

客观说三点：

1. **没有 lint**。没有 ESLint/Prettier 意味着风格靠自觉，PR 里可能因为格式问题来回。
2. **浏览器回归是手动的**。`tests/*.html` 需要人工打开看结果，不在 CI 里（只有 `playback.yml` 跑 Playwright 的那部分自动化）。
3. **联网测试在 CI 里跑不了**。严格模式会拒绝解析到私网的域名，而 CI runner 的 DNS 环境不可控。所以「上游接口是否还兼容」这件事**没有自动化保障**。

**一句话记住：** 这个项目用「类型检查 + Rust 单测 + 手动浏览器回归 + 一条 Playwright CI」四层守住质量，但联网路径完全没有 CI——这正是作者声明「不跟进上游」的技术底气，也是它最大的脆弱点。
