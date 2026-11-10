# 09 运维：装机、端口、日志与故障排查

## 这篇回答什么问题

把 Oink 当基础设施用（或支持别人用）时，需要知道它装在哪、开了哪些端口、数据写在哪、坏了看哪里。这篇是一份运维速查。

## 安装

| 平台 | 包 | 大小（v0.3.5） | 要求 |
|---|---|---|---|
| macOS arm64 | `.dmg` / `.zip` | 44.8MB | macOS 14.2+ |
| macOS x64 | `.dmg` / `.zip` | 44.8MB | macOS 14.2+，README 标"未测试" |
| Windows x64 | `.msi` | 35.2MB | Windows 10 1809（17763）+ 或 11；LTSC 需 WebView2 |

安装包从 GitHub Releases 获取，同时有 `SHA256SUMS` 和 `release.json` 可校验。macOS 版经过 notarization；Windows 版经过 Authenticode 签名。

**升级**：0.3.5 起 Windows 支持"Oink 运行中直接双击 MSI"——安装器会记录当前用户会话，装完通过 `relaunch.json` 自动重启（`crates/oink-winsvc/src/platform/update/relaunch.rs`，修 issue #36）。macOS 用 Sparkle 更新，feed 是 `https://updates.oink.hachiwii.com`（`crates/oink-update/src/feed.rs:44`）。

**回滚**：降级安装旧版 MSI/dmg 即可，但注意设置文件是向前兼容的——新版写入的字段旧版会忽略（`settings.json` 用带默认值的反序列化）。配对记录 `pairing-blocks.cbor` 跨版本兼容，0.3.5 可与 0.3.0 及以上互通（release notes）。

## 端口

| 端口 | 用途 | 来源 |
|---|---|---|
| 47470/tcp+udp | QUIC 交互端口（`DEFAULT_PORT`） | `crates/oink-network/src/config.rs:8` |
| 47471/udp | 发现端口（= port + 1），UDP beacon + DNS-SD | `config.rs:24-26,61` |
| 47472 | bulk 端口（= port + 2），大流量传输 | `config.rs:44` |

端口可在设置里改（`port` 字段）。**发现端口是 port+1 自动推导的**，改主端口会连带改发现端口。beacon 绑定失败不会致命——日志会写 `beacon unavailable; discovery continues using mDNS/DNS-SD and manual addresses`（`discovery/mod.rs`）。

## 数据目录

| 平台 | data | cache | logs |
|---|---|---|---|
| macOS | `~/Library/Application Support/Oink` | `~/Library/Caches/com.hachiwii.oink` | `~/Library/Logs/Oink` |
| Windows | `%LOCALAPPDATA%\Oink` | `%LOCALAPPDATA%\Oink\Cache` | `%LOCALAPPDATA%\Oink\Logs` |

来源：`crates/oink-foundation/src/paths.rs:27,35,39`。设置环境变量 `OINK_HOME` 可以把所有根重定向（`:68`）——测试和多实例隔离用。

关键文件：

- `settings.json` — 全部设置（`crates/oink-agent/src/config.rs:34`）
- `pairing-blocks.cbor` — 配对黑名单/阻断记录（`config/records.rs:11`）
- `presence.cbor` — 在线状态缓存（`config/records.rs:12`）
- `auto-unlock-failure.json` — 自动解锁的失败闩锁（`auto_unlock/mod.rs`）
- `ipc.json` — 本地 IPC 地址、锁 owner、一次性 secret（`ipc.rs`）

**预登录 backend 的特殊性**：Windows 的 `Prelogin` profile 以 SYSTEM 在登录桌面运行，绝不能用按账号的 `LOCALAPPDATA`，所以入口用 `set_process_roots` 固定机器级根（`paths.rs:1-7`）。运维排查时如果发现"服务读不到用户设置"，先确认它在哪个 profile 下跑。

## 日志

- 文件名 `{role}.{date}.log`，角色：`oink`、`oink-ui`、`oink-backend`、`oink-service`、`oink-crash-collector`、`oink-update-worker`、`oink-prelogin`（`crates/oink-agent/src/logs/files.rs:12-20`）。
- 所有角色的普通文本日志**共享一个十进制字节预算**（`files.rs:1`），默认 1024MB（`config/preferences.rs:39-42` 的 `LogMaxMb`）。
- 写日志走独立 worker：队列 1024 条、每批 256 条 / 64KiB（`logs/worker.rs:14-16`），输入线程只投递不格式化。
- 崩溃有独立收集器（`oink-crash-collector`），带 `objc_exceptions` 测试。

## 可观测性

**诊断包**是主要的排障手段：

```bash
# 导出最近 30 分钟（默认）
oink-agent diagnostics save

# 或指定分钟数
oink-agent diagnostics save --last 60

# 或导出全部保留记录
oink-agent diagnostics save --all

# 开关/状态
oink-agent diagnostics status
oink-agent diagnostics on
oink-agent diagnostics off
```

硬上限：整个包 64MiB、单段原始 512KiB、自动记录范围 30 分钟（`diagnostics/mod.rs:113-117`）。隐私边界是"不记录原始按键和自由文本"（`diagnostics/privacy.rs:1`），标识符用 blake3 `derive_key` 匿名化。

**实时指标**（在诊断包里）：

- `late_rounds` / `late_max` — 网络轮迟到次数/最大迟到
- `over_budget` — 超 500µs 预算的轮数
- `demoted` — 实时调度被系统降级的次数（每 5 秒读回比对）

## 资源需求

- **内存**：空闲约几百 MB（Tauri/WebView2 占大头）；剪贴板大对象时可能短时上升（单 representation 上限 256MiB）。
- **CPU**：空闲接近 0；指针高速移动时 input 线程接近单核；音频转发时 audio 线程持续 48kHz 处理。
- **磁盘**：安装包 ~45MB，安装后 ~200MB（含 WebView2 运行时依赖）；日志上限默认 1GB；诊断包上限 64MB。
- **网络**：局域网内输入流量很小（事件级），音频约 128kbps（Opus），文件传输可跑满带宽。

## 故障模式与排查

| 症状 | 可能原因 | 排查 |
|---|---|---|
| 设备互相发现不了 | beacon 绑定失败 / 防火墙挡了 47471 / 不在同一子网 | 日志搜 `beacon unavailable`；改用"手动地址"配对 |
| 配对码一直不确认 | 双方时钟/attempt 不一致，或码输错 | 重新发起配对（attempt 递增）；确认双方版本 ≥0.3.0 |
| 指针跨屏延迟大 | Wi-Fi 抖动 / 走了 relay / 实时调度被降级 | 诊断包看 `demoted`、`late_max`；确认是否 relay 态 |
| 音频断续 | 队列超 12 帧（240ms）触发丢帧 + PLC | 看 `MAX_QUEUE_FRAMES` 相关统计；换有线网络 |
| 自动解锁不触发 | 锁屏状态未知 / 显示器未唤醒 / 本机正在输入 | `auto-unlock-failure.json` 看 failure kind；日志搜"自动解锁已停止" |
| Windows 双击 MSI 后没重启 | relaunch.json 没匹配到会话 | 检查是否多用户登录；`relaunch.rs` 按当前登录用户匹配 |
| 剪贴板重复粘贴 | 对方同步器剥离了 marker，且内容不可比 | 设置里开关 "Clipboard deduplication"；这是 fallback 的已知边界 |
| 服务启动失败 | 端口被占 / 权限不足 / 旧进程残留 | `oink-agent status`；`ipc.json` 的 lock owner |

## 安全注意

1. **配对码必须带外传递**（念给对方/看一眼），不要通过聊天工具发。
2. **`ipc.json` 含一次性 secret**，不要把它复制到别的机器；本地 IPC 只监听用户 SID 管道/私有 socket。
3. **自动解锁的密码只存本地**（Keychain / DPAPI+OnlySystem），不会同步；但一旦本机被攻破，攻击者可以调用本地 API 触发解锁——这是"本机信任"的边界。
4. **更新源不可配置**（`crates/oink-update/src/trust.rs:1`），如果你在企业里需要内部镜像，只能自己重新编译。
5. **诊断包含主机名/设备 ID 的哈希**，但仍然可能含敏感上下文（应用名、窗口标题类别），外发前先自己看一眼。

## 一句话记住

Oink 的运维面很小：**三个端口（47470/47471/47472）、一个数据目录、一份诊断包**——大部分"坏了"都能在 `demoted`、`late_max`、`auto-unlock-failure.json` 这三个地方找到答案。
