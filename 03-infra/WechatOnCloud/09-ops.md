# 09 运维：部署、配置、故障与升级

> 这篇回答什么问题：怎么把 WOC 跑起来？哪些配置必须改？出了故障先看哪里？升级/回滚怎么做才不丢数据？

## 安装（两种方式）

**方式 A：只要 compose 文件（推荐）**

```bash
mkdir woc && cd woc
curl -fsSL https://raw.githubusercontent.com/Gloridust/WechatOnCloud/main/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Gloridust/WechatOnCloud/main/.env.example -o .env
# 编辑 .env：改密码，至少把 WOC_PASSWORD 从 wechat 改掉
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

访问 `http://<NAS_IP>:36080`（`docker-compose.yml:69`）。

> **NAS 用户必看**：面板是经 docker.sock 让 Docker **守护进程**去拉实例镜像的，NAS 自带的 Docker Hub 加速一般只作用于界面手动拉取，不覆盖这条路径。首次新建实例卡在拉镜像时，先在 NAS 界面手动拉一次 `gloridust/wechat-on-cloud:latest`（`README.md:120-123`）。

## 必改配置

| 变量 | 默认 | 说明 | 证据 |
|---|---|---|---|
| `WOC_USER` / `WOC_PASSWORD` | `admin` / `wechat` | 首次启动写入管理员；**必须改** | `.env.example:4-5` |
| `WOC_VERSION` | `latest` | 建议钉到具体版本（不带 `v`）；面板会把实例镜像 tag 对齐到同版本 | `.env.example:9`；`docker.ts:17-26` |
| `WOC_IMAGE_PREFIX` | `docker.io/gloridust` | 拉不动时换 `ghcr.io/gloridust`、`ghcr.nju.edu.cn/gloridust` 或自建 ACR/TCR/SWR | `.env.example:15-20` |
| `WOC_HTTP_PORT` | `36080` | 宿主端口，容器内固定 8080 | `.env.example:32`；`docker-compose.yml:69` |
| `PANEL_ALLOWED_HOSTS` | 空 | 套 HTTPS 反代时填对外域名；支持 `*.example.com` 通配（不含裸域） | `.env.example:44-55` |
| `WOC_TRUSTED_PROXIES` | 空 | 反代在另一台机器时填它的 IP/网段，否则登录限速拿不到真实来源 | `.env.example:63` |
| `WOC_DATA_ROOT` | 空 | 宿主绝对路径，放实例数据；**只影响新建实例** | `.env.example:102` |
| `WOC_INSTANCE_MEM_SOFT_MB` / `_HARD_MB` | 1500 / 2500 | watchdog 阈值 | `.env.example:155-156` |
| `WOC_STUCK_HEAL` | `1` | 卡死自愈开关（0 关闭） | `.env.example:159` |
| `WOC_ENABLE_GPU` | 空 | WSL2/虚拟 GPU 下 `-hw3d` 会持续涨内存，别乱开 | `.env.example:87` |

**改完 env 必须 `docker compose up -d` 重建容器，不是 `docker restart`**——env 只在创建容器时注入（`index.ts:171-172` 的 400 响应 hint 也写了这句）。

完整列表见 `.env.example`（159 行）。

## 数据、日志、端口

| 项 | 位置 | 说明 |
|---|---|---|
| 面板数据 | `./data-panel:/data` | `accounts.json` + `sessions.json` + `logs/`；**丢了账号和实例登记就没了**，但实例容器与卷还在（`docker-compose.yml:58-60`） |
| 实例数据 | 命名卷 `woc-data-<id>` → `/config` | 微信本体（`/config/wechat`）、聊天记录、浏览器配置都在这里（`docker.ts:774-783`） |
| 面板日志 | 容器 stdout + `/data/logs` | json-file 20m×2（`docker-compose.yml:76-77`）；文件日志单文件 512KB、保留 365 天（`logs.ts:12-14`） |
| 实例日志 | 管理页「实例日志」 | 持久化历史 + 本次容器实时日志 + 上一容器最后 200 行快照（`index.ts:1248-1266`、`docker.ts:2033-2040`） |
| 诊断包 | 管理页导出 | 系统信息、面板/实例日志、容器清单、崩溃转储**摘要**（不含内存内容）（`docker.ts:1655-1824`） |
| 端口 | 仅 `36080 → 8080` | 实例不映射任何宿主端口（`docker-compose.yml:69`；`docker.ts:806-815`） |

## 备份与迁移

WOC 有两类状态，备份方式完全不同：

| 状态 | 在哪 | 怎么备 | 怎么恢复 |
|---|---|---|---|
| 账号 + 实例登记 + 会话 + 日志 | `./data-panel`（`accounts.json`、`sessions.json`、`logs/`） | 直接 `tar` 整个目录，或停面板后复制 | 停面板 → 覆盖目录 → 启动 |
| 实例数据（微信本体、聊天记录、浏览器配置） | 命名卷 `woc-data-<id>` 或 `WOC_DATA_ROOT` 下的目录 | 管理页「数据卷 → 下载」走流式 gzip（`index.ts:1479-1491`）；或宿主侧 `docker run --rm -v woc-data-<id>:/c -v $PWD:/b alpine tar czf /b/x.tgz -C /c .` | 管理页「恢复」：停实例 → 写入 → 恢复原运行状态；失败会挪回原数据（`docker.ts:2456-2494`） |

迁移到新机器时**两边都要搬**：只搬卷，面板会因为没有实例登记而看不到它（可以用「复用已有卷」重新登记，卷名必须匹配 `woc-data-<10hex>`，`index.ts:598-627`）；只搬 `data-panel`，实例会全部显示 `missing`。

## 资源规划

| 场景 | 建议 |
|---|---|
| 1 个微信实例（轻度） | 2 核 / 2 GiB |
| 3–4 个实例 | 4 核 / 8 GiB |
| 每实例预留 | 1 vCPU + 1.5 GiB（活跃），另加 1 GiB `/dev/shm` |
| 面板 | ~0.15 GiB |

证据：`README.md:164-178`。**内存是主要瓶颈，按实例线性叠加**。

## 可观测性：先看哪里

1. **面板日志**：登录失败、反代 502、自愈、升级都会写；管理页可看，也可导出诊断包。
2. **实例日志**：`[vnc]` 三段（尝试 / 上游 101 / 关闭）能区分「卡在面板→实例」还是「实例内部卡住」（`index.ts:1932-1943`、`2027-2035`）。
3. **诊断包**：一键拉系统信息 + 容器状态（含 OOMKilled / RestartCount / 实际 HostConfig）+ 崩溃转储摘要（`docker.ts:1655-1824`）。
4. **`docker stats`**：看 working set；watchdog 用的就是 `usage - inactive_file`（`docker.ts:1097-1110`）。

## 故障速查

| 症状 | 先查 | 处理 |
|---|---|---|
| 桌面一直「连接中」 | 实例日志是否有 25s 无应答的 `[vnc]` | 等自动自愈（10 分钟 2 次触发）；或管理页「卡死自愈」；再不行重启实例 |
| 502 / 黑屏 | 面板与实例是否在同一自定义网络 | 设 `WOC_DOCKER_NETWORK`；重启实例迁移网络（`docker.ts:377-415` 的启动体检会点名） |
| 新建实例卡在拉镜像 | Docker 守护进程直连 `docker.io` 超时 | 先在 NAS 界面手动拉一次实例镜像（`README.md:120-123`） |
| 卡片显示「创建失败」 | 卡片上的 `createErrorHint` | 按提示修（磁盘/限流/tag 不存在/内存太小），再点「重试创建」 |
| 磁盘满 / 升级卡死 | 旧镜像、crashinfo、日志 | 清悬空镜像；检查 `WOC_DATA_ROOT` 所在盘；容器日志已限 40MB/实例 |
| 忘记超管密码 | — | 停面板 → 编辑 `data-panel/accounts.json` 给 admin 加 `"resetPassword": true` → 启动，密码重置为初始口令并解禁（`store.ts:133-145`） |
| 微信无法启动 | 数据卷是否 `noexec` | 换可执行卷；或用 `WOC_DATA_ROOT` 指到普通目录 |
| 反代后 400 Host not allowed | `PANEL_ALLOWED_HOSTS` | 把 400 响应里回显的 `host` 值加进白名单，然后 `up -d` 重建（`index.ts:160-174`） |
| 上传大文件 507 | 面板数据目录剩余空间 | spool 需 `文件大小 + 256MiB` 余量（`upload.ts:57-102`） |
| 升级后实例起不来 | 上一版镜像是否已被 prune | `WOC_KEEP_OLD_IMAGES=1` 可关闭旧镜像回收（`docker.ts:933-976`） |

## 升级与回滚

| 对象 | 怎么做 | 回滚 |
|---|---|---|
| 面板 | 管理页「自更新」，或 `docker compose pull && up -d` | 把 `WOC_VERSION` 钉回上一版重新 `up -d`；自更新失败会自己回滚到旧镜像 id（`self-update.ts:259-281`） |
| 实例 | 管理页「升级实例」/「一键升级」 | 旧镜像被 prune 前可回退；升级不改变运行状态（原本停着仍停着，`docker.ts:896-905`） |
| 数据 | 升级前在「数据卷」页下载备份 | 用恢复功能写回（先停实例、失败恢复原状态，`index.ts:1494-1520`、`docker.ts:2456-2494`） |

**更新面板 ≠ 更新实例**：两个镜像分开升级，发布说明必须显式提示。跨大版本升级前先备份数据卷。

## 安全运维清单

- [ ] 改默认密码（`admin` / `wechat`）。
- [ ] 面板不裸暴露公网；必须经 HTTPS 反代 / VPN / 内网穿透。
- [ ] `PANEL_ALLOWED_HOSTS` 填对外域名；反代在别处时配 `WOC_TRUSTED_PROXIES`。
- [ ] 能接受 docker.sock 风险，或改用 `docker-compose.secure.yml`（`docker-compose.secure.yml:1-64`）。
- [ ] 定期备份 `./data-panel` 与 `woc-data-*`。
- [ ] 关注实例镜像版本，及时升级（Chromium 有安全更新）。
- [ ] 升级前读 release notes 的「谁受影响 / 要不要升级实例 / 回滚指引」。

## License 提醒（运维也要看）

仓库无 LICENSE，GitHub 标 NOASSERTION。**自用可以；商用、对外提供服务、二次分发前必须联系作者取得许可**；不要因为能 `docker pull` 就默认可以商用。

## 一句话记住

WOC 的运维只有两件事：**守住 docker.sock 和密码，守住数据卷和镜像版本**；其余故障基本都能靠「重启实例（保留镜像）」恢复。
