# 07 参与：怎么在 Oink 上改第一行代码

## 这篇回答什么问题

Oink 是一个 Rust + TypeScript + Swift 多语言仓库，构建链比一般 Rust 项目复杂。这篇给出"从 clone 到提 PR"的最小路径，以及几个容易踩的坑。

## 系统与工具链

| 依赖 | 版本要求 | 来源 |
|---|---|---|
| Rust | 1.99.0（edition 2024） | `rust-toolchain.toml`、`Cargo.toml` |
| rustfmt / clippy | 随 toolchain | `rust-toolchain.toml` components |
| Node.js | 24.14.1 | 根 `package.json` `engines` |
| npm | 11.11.0 | 根 `package.json` `packageManager` |
| Python | 3.14.6（CI） | `.github/workflows/ci.yml` |
| macOS | 14.2+（部署目标 `MACOSX_DEPLOYMENT_TARGET=14.2`） | CI env |
| Windows | x64 10 1809（17763）+ 或 11 | `README.md:21` |

平台支持：macOS arm64 官方支持；Intel x64 在 0.3.4 起支持但 README 说"未测试"（`README.md:20`）；Windows 只有 x64。**没有 Linux 版本**。

## 构建与运行

```bash
# 前端依赖（仓库根，npm workspaces）
npm ci

# 开发模式：Tauri 壳 + Vite，前端在 http://127.0.0.1:1440
npm run -w apps/oink dev

# 前端类型检查 / 测试 / 构建
npm run -w apps/oink typecheck
npm run -w apps/oink test
npm run -w apps/oink build

# Rust 侧
cargo build --locked
cargo test --locked
cargo test --locked --release --lib   # release 模式跑 lib 测试（CI 也跑）

# 完整检查（clippy -D warnings + test + release check + release lib test）
python build-support/ci.py

# 慢测试（ignored 测试 + 前端 test:slow + packaging + build-support 自身测试）
python build-support/ci.py --slow

# macOS Swift 入口编译检查 + provider 纯测试
python packaging/macos/check.py --test

# 依赖许可证/安全策略
cargo deny check
```

`apps/oink` 的 Tauri 壳会**在独立进程启动 backend**，两者通过本地 IPC（AgentApi：Request / Reply / ApiEvent）通信。所以改后端时前端不需要重启，但改 IPC 协议两边都要动。

## 系统权限

这是软件 KVM，权限需求是硬性的：

- **macOS**：辅助功能（Accessibility）用于 CGEventTap 捕获和 CGEventPost 注入；输入监控（Input Monitoring）；屏幕录制（Screen Recording）用于屏幕识别/壁纸；自动化（Apple Events）用于部分应用交互。打包时用 TCC 的 usage description 声明。
- **Windows**：捕获用低级钩子（`WH_KEYBOARD_LL` / `WH_MOUSE_LL`），注入用 `SendInput`；服务组件（`oink-service`）以 SYSTEM 运行；预登录 backend 也以 SYSTEM 在登录桌面运行（`node.rs:34` 的 `Prelogin`）。
- **签名**：macOS 需要 Developer ID + notarization；Windows 需要 Authenticode。CI 的 `packaging/` 目录和 `.signpath/` 配置负责这些。

## CI 矩阵

`.github/workflows/ci.yml` 的矩阵：

| OS | 架构 | 并发 jobs |
|---|---|---|
| macos-15 | aarch64-apple-darwin | 2 |
| macos-15-intel | x86_64-apple-darwin | 2 |
| windows-2022 | x86_64-pc-windows-msvc | 4 |

超时 120 分钟。步骤顺序：架构断言 → 安装 npm 11.11.0 → macOS 选 OpenSSL 3（Ed25519 `pkeyutl -rawin`）→ 前端 typecheck/test/build + `cargo about` + 许可证检查 → macOS Swift 检查 → `cargo fmt --all --check` + `build-support/ci.py` → packaging 单元测试 → Windows 打包（`package.py --public-version --platform windows --build 28`）→ `cargo deny check`。

发布走 `.github/workflows/release.yml`（`workflow_dispatch`，输入 build 号，如 0.3.5 用 113），产出 macOS arm64/x64 的 dmg+zip、Windows x64 msi、`release.json`、`SHA256SUMS`。

## Issue / PR 规则

上游 `README.md:33` 明确写：

> 不接受无上下文的 PR；请先开 Issue 讨论。

也就是说**不要直接提代码 PR**。正确路径是：开 Issue 描述问题/需求 → 维护者确认 → 再提 PR。这对一个单人维护的项目（contributors 只有 `hachiwii`）是合理的——没有精力 review 突然出现的大补丁。

## 3–5 个新手入口

1. **`crates/oink-routing/src/router.rs` 的 `DecisionKind`**（`:104`）：先读懂 8 种决策，再看 `drain_outputs`（`:1575`）。这是整个项目的"心脏"，改这里能理解全局。
2. **`crates/oink-network/src/link/mod.rs:1-21`**：一个文件读懂网络层的全部设计意图，再看 `runtime.rs:270-310` 的预算循环。
3. **`crates/oink-protocol/src/v1/registry_entries.rs`**：消息注册表。加一个消息从这里开始，顺着 `dto/` 和 `streams/` 往下走。
4. **`crates/oink-audio/src/dsp.rs`**：音频队列/PLC/重采样都在一个文件里，常量集中在文件头。
5. **`apps/oink/src-tauri/src/`**：前端与 backend 的边界，`window_paint.rs` 是理解 macOS 窗口呈现的好例子。

## 坑

1. **`crates/oink-credential-provider/` 不在 workspace members 里**（根 `Cargo.toml:3-21`）。它有自己的 `README.md`/`ipc.hpp`/`provider.cpp`，是 Windows 凭据提供程序的独立构建产物，`cargo build` 不会编译它。别以为它坏了。
2. **edition 2024 + rust-version 1.99.0**：老工具链直接编译失败，且错误信息通常是"不认识 edition"。先 `rustup override set 1.99.0`。
3. **`unsafe_op_in_unsafe_fn = deny`**：所有 `unsafe fn` 内部还要再包一层 `unsafe {}`。这是团队风格，不是笔误。
4. **Windows 打包需要 Python 3.14 + WiX/签名工具**：`build-support/package.py` 不是纯 Rust 构建，CI 里专门有一步。
5. **macOS 的 TCC 权限在开发构建里会反复弹**：每次重新签名二进制，系统都当成新应用。用稳定的签名身份能减少弹窗。
6. **`npm run -w apps/oink test` 默认跳过慢测试**：`test:slow` 才是完整的（0.3.5 的 `vitest.slow.config.ts`）。
7. **`oink-agent` 是双 bin 结构**：`oink-backend`（`crates/oink-agent/src/backend/main.rs`）和 CLI（`crates/oink-agent/src/main.rs`）共享同一个库，但启动参数不同。改 `main.rs` 时先确认改的是哪一个，否则会出现"CLI 改了、服务没变"的假象。

## 一句话记住

在 Oink 上贡献的正确顺序是：**先开 Issue 再写代码，先跑 `python build-support/ci.py` 再提 PR**——这个仓库的复杂度不在 Rust，而在"Rust + TS + Swift + 打包 + 签名"这条链上。
