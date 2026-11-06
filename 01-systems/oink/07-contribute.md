# 07 参与贡献：从“能跑”到“提得动”

> 先看贡献政策：`README.md:31-33` 明确说 **不接受没有上下文的 PR**，因为“没有时间 review 代码”。所有 bug/feature 先走 Issues，并带上设备环境、诊断数据、复现步骤、AI 辅助调查的结论。这一条会改变你的参与策略。

## 贡献路径排序（现实版）

| 路径 | 难度 | 适合谁 | 说明 |
|---|---|---|---|
| 平台实测 + 详细 Issue | 低 | 有 Mac/Windows 真机的人 | 项目最缺真实环境反馈；README 说这是“最大的贡献” |
| 文档/i18n | 低-中 | 前端/写作 | `apps/oink/src/i18n/` 已有 en/ja/ko；中文文案可补 |
| 测试/复现 | 中 | Rust/TS 测试 | `router/*_tests.rs`、`protocol/tests/v1_*.rs`、`audio/dsp.rs` 测试 |
| 打包/CI | 中 | 运维/DevOps | `packaging/`、`build-support/`、GitHub Actions |
| 平台适配 | 高 | 系统程序员 | macOS `objc2`、Windows `windows` crate、输入注入 |
| 核心协议/路由 | 高 | 架构/实时系统 | 先读 `router.rs`、`link/mod.rs`，并与作者沟通 |

## 开发环境

### 必需版本（CI 固定）

- Rust `1.99.0`（`.github/workflows/ci.yml` 的 `dtolnay/rust-toolchain`）
- Node `24.14.1`
- npm `11.11.0`
- Python `3.14.6`
- macOS 15 arm64 或 Windows Server 2022 x64（CI matrix）
- macOS 部署目标 `14.2`

### 本机准备

```bash
# Rust
rustup toolchain install 1.99.0
rustup component add rustfmt clippy --toolchain 1.99.0

# Node
nvm install 24.14.1
npm install -g npm@11.11.0

# Python 3.14.6（按系统方式安装）

# 前端依赖
npm ci
```

### 构建

```bash
# 前端
npm run -w apps/oink typecheck
npm run -w apps/oink test
npm run -w apps/oink build

# Rust
cargo build -p oink-ui
cargo test -p oink-routing
cargo test -p oink-network
cargo test -p oink-protocol
```

### CI 同款命令

`.github/workflows/ci.yml:80-110`：

```bash
npm ci
npm run -w apps/oink typecheck
npm run -w apps/oink test
npm run -w apps/oink build
npm run licenses:check -- --release-sources
cargo fmt --all --check
python build-support/ci.py
python -m unittest discover -s packaging/tests -v
cargo deny check
```

macOS 额外：

```bash
python packaging/macos/check.py --test
```

Windows 额外：

```bash
python build-support/package.py --public-version --platform windows --build 28 --output-root <temp>
```

## 代码约定

- `Cargo.toml:57-66`：
  - `unsafe_op_in_unsafe_fn = "deny"`
  - `missing_debug_implementations = "warn"`
  - `dbg_macro`、`todo`、`unimplemented`、`undocumented_unsafe_blocks` 警告。
- 模块文档优先：文件开头写“拥有什么/不做什么”，参考 `threads/mod.rs:1-15`、`network/src/link/mod.rs:1-19`。
- 实时线程禁止：分配、等待、文件 I/O、日志格式化（`threads/mod.rs:12-15`、`router.rs:130`）。
- 前端：用 `oink-ui` 组件 + `--ok-*` CSS 变量；文案走 `src/i18n/`（`apps/oink/README.md:25-27`）。
- 测试：尽量与代码同 crate；协议测试用 `crates/oink-protocol/tests/v1_*.rs` 和 `tests/fixtures/v1/` golden 文件。

## Issue 怎么写（作者最想要的）

按 `README.md:33` 的要求：

1. **设备环境**：macOS 版本/芯片，Windows 版本/架构，Oink 版本。
2. **诊断数据**：设置里的日志、`oink-agent` 诊断、崩溃报告（如有）。
3. **复现步骤**：从启动到问题发生的最小步骤。
4. **预期 vs 实际**：不要只说“不能用”。
5. **AI 辅助调查结论**：你读过哪些代码、怀疑哪条路径、验证了什么。
6. **附件**：截图/录屏/日志；大文件用链接。

## 从 Issue 到 PR 的现实流程

1. 先开 Issue，描述问题和你的调查。
2. 等作者回复；不要直接提大 PR。
3. 如果作者邀请，先提小 PR：测试/文档/小修复。
4. PR 描述里链接 Issue，说明“改了什么/为什么/怎么验证”。
5. 跑 CI 同款命令，附结果。
6. 接受“作者可能没时间 review”的现实；小而聚焦的 PR 更容易被看。

## 高价值贡献点（基于代码结构）

| 点 | 位置 | 为什么有价值 |
|---|---|---|
| 输入路由边界测试 | `crates/oink-routing/src/router/*_tests.rs` | 纯状态机，测试成本低，覆盖真实边界 |
| 协议 golden/兼容测试 | `crates/oink-protocol/tests/v1_*.rs` | 协议是长期契约，回归价值高 |
| 音频 DSP 边界 | `crates/oink-audio/src/dsp.rs` 底部测试 | 实时音频 bug 难复现，测试稀缺 |
| Windows 服务/ prelogin | `crates/oink-winsvc/src/` | 登录前场景复杂，真机测试少 |
| 打包/签名/回滚 | `packaging/`、`build-support/update/` | 发布链路是高风险区 |
| 平台实测 | macOS/Windows 真机 | README 明确说这是最大贡献 |

## 许可证与合规

- 代码：GPL-3.0-only + additional terms（`README.md:49-54`）。
- 分发修改版：必须提供完整源码、保留作者归属/许可、标记修改；附加条款还禁止用 Oink 名称推广衍生品。
- 只自己使用、不分发：没有这些义务。
- 贡献前确认你有权提交代码；不要复制不兼容许可证的代码。

## 风险与反证

- 项目明确“没有时间 review”，所以“PR 排队很久”是预期，不是意外。
- 0.3.3 版本，核心 API/协议仍可能变；不要基于“稳定 API”做长期插件。
- Windows 服务/UIAccess/输入注入涉及提权与安全，改动风险高；没有真机不要盲改。
- macOS 只支持 Apple silicon；Intel Mac 无法完整验证。

## 关键证据

- 贡献政策：`README.md:31-33`
- 平台：`README.md:20-21`
- 许可证：`README.md:49-54`
- CI 版本/命令：`.github/workflows/ci.yml`
- 代码规范：`Cargo.toml:57-66`
- 实时约束：`crates/oink-agent/src/threads/mod.rs:12-15`
- 前端约定：`apps/oink/README.md:25-27`
