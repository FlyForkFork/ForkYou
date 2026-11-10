# 07 · 贡献指南：想提 PR 之前先看这三件事

**这篇回答什么问题**：这个项目接受外部贡献吗？本地怎么把环境跑起来？改完怎么验证？CI 会替你检查什么、不会检查什么？新手上手该从哪下手？

## 结论先行

1. **项目接受 PR，但没有 CONTRIBUTING.md、没有 issue 模板、没有 PR 模板**。规矩全写在 `AGENTS.md` 和 `CLAUDE.md` 里，靠自觉。
2. **CI 只构建 Docker 镜像，不跑测试**。`docker-image.yml` 的触发条件是"PR 合并进 master"或手动触发，两个 job 都是 `docker build` + `push ghcr`，没有任何 `pytest` 步骤。所以测试全绿与否，review 的人只能本地跑。
3. **合并后的 push 会自动发多架构镜像**（`linux/amd64,linux/arm64`），也就是你的代码一进 master 就进了 `ghcr.io/usagi-org/ai-goofish:latest`。这一点比其他项目激进，PR 前务必本地跑通。
4. 有一条 `@claude` 机器人通道：issue 或 PR 评论里写 `@claude`，GitHub Actions 会拉起 claude-code-action 自动改代码。20 个 `claude/issue-*` 分支就是这么来的（见 `06-branches.md`）。

## 工具链与系统要求

| 项 | 要求 | 证据 |
|---|---|---|
| Python | 3.10+（Docker 镜像固定 3.11-slim-bookworm） | `README.md:129`、`Dockerfile:9` |
| Node.js | 本地验证过 v20.18.3；Docker 用 node:22-alpine | `README.md:130`、`Dockerfile:2` |
| 浏览器 | Chrome / Edge / Chromium 任选；Docker 镜像内装 Chromium | `README.md:131-132`、`Dockerfile:41` |
| 系统库 | Linux 需 `libzbar0`（二维码识别）、`tini`（PID 1 信号转发） | `Dockerfile:34-36` |
| 系统支持 | macOS / Linux（deb/rpm/arch）/ WSL / Windows(MSYS) 四套分支 | `start.sh:35-53` |

`start.sh` 会自动探测 OS 家族并给出对应的缺依赖修复命令（`start.sh:119-200` 附近按 macos/linux-deb/linux-rpm/arch/wsl/windows 分六套文案）。这是本项目对新手最友好的地方：跑不起来时先看它打印的提示。

## 本地开发四步

```bash
# 1. 依赖
cp .env.example .env          # 填 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL_NAME
python3 -m pip install -r requirements.txt   # 含 pytest/coverage 等开发依赖
python3 -m playwright install chromium

# 2. 后端（热重载）
uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload

# 3. 前端（另开终端，Vite 代理 /api /auth /ws 到 8000）
cd web-ui && npm install && npm run dev

# 4. 前端构建（产物直接写 ../dist，后端会 mount）
cd web-ui && npm run build    # 实际执行 vue-tsc -b && vite build
```

一键脚本 `./start.sh` 做的是同一件事的串联：检查环境 → 清 `dist/` → `pip install` → `npm run build` → 校验 `dist/index.html` 存在 → `python3 -m src.app`（`start.sh` 六步标题可见）。

## 测试命令（从 `tests/README.md` 与 `pyproject.toml` 反推）

| 目的 | 命令 |
|---|---|
| 全部单测 + 集成 | `pytest` |
| 单文件 | `pytest tests/unit/test_utils.py` |
| 单函数 | `pytest tests/unit/test_utils.py::test_safe_get_nested_and_default` |
| 覆盖率 | `coverage run -m pytest && coverage report` |
| 真实流量冒烟 | `./run_live_smoke.sh`（需 `state/*.json` 登录态） |
| 只跑冒烟主链路 | `./run_live_smoke.sh --without-generation` |

三个必须知道的约定：

1. **测试默认离线**。`tests/README.md` 明确写"外部依赖（Playwright/AI/通知/网络）统一 mock"，`tests/conftest.py:47-56` 起的 `FakeProcessService` / `FakeSchedulerService` 就是干这个的。
2. **live 测试默认跳过**。`tests/live/conftest.py:18-25` 在 `RUN_LIVE_TESTS != "1"` 时给所有 `live` / `live_slow` 用例打 skip。
3. **`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`**。`run_live_smoke.sh` 默认设置它，避免本机装的其他 pytest 插件干扰。本地跑全量测试建议照抄。

`pyproject.toml` 只配了 pytest 与 coverage，**没有 ruff / black / flake8 / eslint**。前端 `npm run build` 里的 `vue-tsc -b` 是唯一的静态检查。

## CI 矩阵与发布流程

`.github/workflows/docker-image.yml` 两个 job 串行：

```
build-base   →  Dockerfile.base   → ghcr.io/<owner>/ai-goofish-base:latest + :<sha>
                                   platforms: linux/amd64,linux/arm64
build-and-push → Dockerfile.release → ghcr.io/<owner>/ai-goofish:latest + :<sha>
                                   build-arg BASE_IMAGE=<上面那个>
```

几个设计细节值得注意：

- `Dockerfile.base` 只装 Playwright + Chromium + 系统库，变一次要十几分钟；`Dockerfile.release` 引用它，只 COPY 代码。分层是为了让日常发布不重装浏览器。
- `cache-to: type=gha,scope=...,mode=min,ignore-error=true` 的注释写得很实在：`mode=max` 会把 Chromium 和 apt 中间层打进同一条 cache，双架构容易撞 GitHub Actions 单条 10GB 上限，"reserve 失败会取消已经构建好的镜像推送"（`.github/workflows/docker-image.yml:88-90`）。所以退回 `mode=min`。
- `pull: true` 保证基础镜像是最新的，不会被本地旧层骗过去。

**没有 release tag 流水线**。README 里 ghcr 的 `latest` 就是发布通道，版本号靠 GitHub Releases 手工打（现有 5 个：v2.1 → 2.5）。

## Issue / PR 规则

仓库没有模板，只能从 `AGENTS.md`、`CLAUDE.md` 与 commit 风格反推：

| 项 | 实际约定 | 证据 |
|---|---|---|
| commit 格式 | 类 Conventional Commits：`feat(...)` / `fix(...)` / `refactor(...)` / `chore(...)` / `docs(...)` | `AGENTS.md` 提交与 PR 规范 |
| PR 描述 | 说明变更范围与影响模块；UI 变更贴 `web-ui/` 截图；关联 issue；写配置/迁移步骤 | 同上 |
| 测试要求 | PR 前跑相关测试，新逻辑补针对性用例 | 同上 |
| 分支策略 | master 为唯一主线；dev 落后于 master，不要往 dev 提 | `06-branches.md` |

## 5 个适合新手的入口

1. **补区域筛选的结果侧校验**。`codex/github-mention-harkmq` 已经写好 40 行参考实现（`_parse_region_filters` / `_item_matches_region_filter`），但没测试、没合并。把它 rebase 到 master 并补 `tests/unit/` 用例，是性价比最高的一血。
2. **给 `result_storage_service` 加分页下推**。`src/services/result_storage_service.py:114-147` 现在是全量 `SELECT` + Python 切片（见 `05-performance.md`），改成 SQL `LIMIT/OFFSET` 有明确收益、有现成测试可扩。
3. **补前端 i18n**。`web-ui/src/i18n/` 已有中英双语，`web-ui/src/views/SettingsView.vue:4-18` 也接了 `useI18n()`，但后端 349 行的 `src/api/routes/settings.py` 里不少校验提示是硬编码中文，前端拿到的报错不会翻译。做一轮错误码化 + `t()` 替换，风险低。
4. **加一个通知渠道**。`src/infrastructure/external/notification_clients/` 下已有 7 个实现（ntfy/pushplus/bark/gotify/wecom/telegram/webhook），照着 `base.py` 的 `NotificationMessage` 实现一个新 client 即可，属于"模板清晰、边界明确"的活。
5. **补 `tests/live/` 的失败分支**。现在 live 只覆盖 happy path（`tests/live/test_live_smoke.py`），风控弹窗、登录失效这两条最常发生的路径没有真实流量用例。

## 贡献前必须知道的坑

1. **不要提交 `state.json` / `.env`**。`AGENTS.md` 明说"不要提交真实凭据或 cookies"，`xianyu-login-state-privacy.html` 专门解释了登录态里有什么。
2. **Windows 上停止任务不走进程组**。`src/services/process_service.py:107` 只在非 Windows 用 `os.setsid`；`:259-279` 的 `_terminate_process` 在 Windows 下退回 `process.terminate()` / `process.kill()`，杀不掉孙子进程。跨平台改动要两边都测。
3. **前端构建产物在 `../dist`**。`web-ui/vite.config.ts:8-11` 的 `outDir` 指到仓库根的 `dist/`，不是 `web-ui/dist`。改了构建配置记得同步后端 mount 路径（`src/app.py:123-124`）。
4. **`pyzbar` 依赖系统 `libzbar`**。本地跑二维码解析失败，先装系统库，不是 Python 包的问题。
5. **别改 `prompts/base_prompt.txt` 的版本标记**。`src/prompt_utils.py:12-35` 的元提示词要求生成结果保留 `[V6.3 核心升级]` / `[V6.4 逻辑修正]`，模型靠这个判断标准版本。

## 一句话记住

PR 能提、但没有模板也没有测试门禁，合并即发多架构镜像；本地跑通 `pytest` + `npm run build` 再提，第一血从区域筛选校验或 `result_storage_service` 分页开始。
