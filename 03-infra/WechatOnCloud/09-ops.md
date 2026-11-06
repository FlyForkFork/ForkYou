# 09 运维：部署、配置、故障与升级

> 这篇回答什么问题：怎么把 WOC 跑起来？出了故障先看哪里？升级/回滚怎么做才不丢数据？

## 安装（两种方式）

**方式 A：只要 compose 文件（推荐）**

```bash
mkdir woc && cd woc
curl -fsSL https://raw.githubusercontent.com/Gloridust/WechatOnCloud/main/docker-compose.yml -o docker-compose.yml
# 建议先改默认密码（默认 admin / wechat）
docker compose up -d
```

**方式 B：本地构建**

```bash
git clone https://github.com/Gloridust/WechatOnCloud.git
cd WechatOnCloud
cp .env.example .env    # 改密码
./scripts/build-local.sh
docker compose up -d
```

访问 `http://<NAS_IP>:36080`。证据：`README.md:93-118`；`docker-compose.yml:68-69`。

## 必改配置

| 变量 | 默认 | 说明 | 证据 |
|---|---|---|---|
| `WOC_USER` / 管理员密码变量 | `admin` / `wechat` | 首次启动写入管理员；**必须改** | `.env.example:3-5` |
| `WOC_VERSION` | `latest` | 建议钉到具体版本（不带 v） | `.env.example:7-9` |
| `WOC_IMAGE_PREFIX` | `docker.io/gloridust` | 拉不动时换 GHCR/国内反代 | `.env.example:11-20` |
| `WOC_HTTP_PORT` | `36080` | 宿主端口，容器内固定 8080 | `.env.example:30-32` |
| `PANEL_ALLOWED_HOSTS` | 空 | 套 HTTPS 反代时填对外域名；支持通配 | `.env.example:34-55` |
| `WOC_TRUSTED_PROXIES` | 空 | 反代在另一台机器时填它的 IP/网段 | `.env.example:57-63` |
| `WOC_DATA_ROOT` | 空 | 宿主绝对路径，放实例数据；只影响新建实例 | `.env.example:93-102` |
| `WOC_INSTANCE_MEM_SOFT_MB` / `HARD` | 1500 / 2500 | watchdog 阈值 | `.env.example:142-157` |
| `WOC_STUCK_HEAL` | `1` | 卡死自愈开关 | `.env.example:148-152` |

完整列表见 `.env.example:1-159`。

## 数据、日志、端口

| 项 | 位置 | 说明 |
|---|---|---|
| 面板数据 | `./data-panel:/data` | `accounts.json` + `sessions.json`；**丢了账号/实例元数据就没了**（`docker-compose.yml:58-60`） |
| 实例数据 | 命名卷 `woc-data-<id>` → `/config` | 微信本体、聊天记录、浏览器配置都在这里（`panel/server/src/docker.ts:775`） |
| 面板日志 | 容器 stdout + `/data` 内日志文件 | json-file 20m×2（`docker-compose.yml:71-77`）；文件日志 512KB/365 天（`panel/server/src/logs.ts:12-14`） |
| 实例日志 | 面板「实例日志」+ 持久化历史 | 重启原因 + 上一容器日志快照（`panel/server/src/docker.ts:2033-2054`） |
| 诊断包 | 管理页导出 | 系统信息、面板/实例日志、容器清单、crashinfo（`panel/server/src/docker.ts:1655-1825`） |
| 端口 | 仅 `36080→8080` | 实例不映射宿主端口（`docker-compose.yml:68-69`） |

## 资源规划

| 场景 | 建议 |
|---|---|
| 1 个微信实例 | 2 核 / 2GiB（轻度） |
| 3–4 个实例 | 4 核 / 8GiB |
| 每实例预留 | 1 vCPU + 1.5GiB（活跃），另加 1GiB `/dev/shm` |
| 面板 | ~0.15GiB |

证据：`README.md:164-178`。

## 可观测性：先看哪里

1. **面板日志**：登录失败、反代 502、自愈、升级都会写；管理页可看。
2. **实例日志**：`[vnc]` 三段（尝试/上游 101/关闭）可判断卡在「面板→实例」还是实例内部（`doc/dev/稳定性设计.md:23`）。
3. **诊断包**：一键拉系统信息 + 容器状态 + crashinfo 摘要（`panel/server/src/docker.ts:1655-1825`）。
4. **`docker stats`**：看 working set，watchdog 用的就是它（`panel/server/src/docker.ts:1097-1110`）。

## 故障速查

| 症状 | 先查 | 处理 |
|---|---|---|
| 桌面一直「连接中」 | 实例日志是否有 `[vnc]` 25s 无应答 | 等自动自愈；或管理页「卡死自愈」；再不行重启实例（`doc/部署与运维.md:26-41`） |
| 502 / 黑屏 | 面板与实例是否同网络 | `WOC_DOCKER_NETWORK` 显式指定；重启实例迁移网络（`doc/部署与运维.md:26-41`） |
| 新建实例卡在拉镜像 | Docker 守护进程直连 `docker.io` 超时 | 先在 NAS Docker 界面手动拉一次实例镜像（`README.md:120-123`） |
| 磁盘满 / 升级卡死 | 旧镜像、crashinfo、日志 | 清理悬空镜像；检查 `WOC_DATA_ROOT` 所在盘 |
| 忘记超管密码 | — | 离线编辑 `accounts.json` 给 admin 加 `resetPassword:true`，重启面板（`doc/部署与运维.md:47-71`） |
| 微信无法启动 | 数据卷是否 `noexec` | 换可执行卷；`doc/部署与运维.md:9-20` |
| 反代后 400 Host not allowed | `PANEL_ALLOWED_HOSTS` | 把错误响应里回显的 host 加进白名单（`.env.example:51-55`） |

## 升级与回滚

| 对象 | 怎么做 | 回滚 |
|---|---|---|
| 面板 | 管理页「自更新」或 `docker compose pull && up -d` | 把 `WOC_VERSION` 钉回上一版，重新 `up -d`（`panel/server/src/self-update.ts:226-281`） |
| 实例 | 管理页「升级实例」/「一键升级」 | 面板按版本 tag 拉镜像；旧镜像被 prune 前可回退（`panel/server/src/docker.ts:933-976`） |
| 数据 | 升级前在「数据卷」页下载备份 | 用恢复功能写回（先停实例，`panel/server/src/index.ts:1494-1520`） |

**更新面板 ≠ 更新实例**：两个镜像分开升级，发布说明必须显式提示（`doc/dev/稳定性设计.md:82-84`）。升级前先备份数据卷，尤其是跨大版本。

## 安全运维清单

- [ ] 改默认密码（默认 admin / wechat）。
- [ ] 面板不裸暴露公网；必须经 HTTPS 反代/VPN。
- [ ] `PANEL_ALLOWED_HOSTS` 填对外域名。
- [ ] 能接受 docker.sock 风险，或用 `docker-compose.secure.yml`。
- [ ] 定期备份 `./data-panel` 与 `woc-data-*`。
- [ ] 关注实例镜像版本，及时升级（Chromium 有安全更新）。

## License 提醒（运维也要看）

仓库无 LICENSE，GitHub 标记 NOASSERTION。**自用可以，商用/对外服务/二次分发前必须联系作者取得许可**；不要因为能 `docker pull` 就默认可以商用。

## 一句话记住

WOC 的运维只有两件事：**守住 docker.sock 和密码，守住数据卷和镜像版本**；其余故障都能重启恢复。
