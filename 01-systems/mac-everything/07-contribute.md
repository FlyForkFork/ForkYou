# 07 贡献：跑起来、测起来、提 PR

> 这篇回答什么问题：一个新人怎么从 0 到第一个 PR，以及这个仓库有哪些别人踩过的坑。

## 环境要求

| 项 | 要求 | 证据 |
|---|---|---|
| macOS | 14+（`DEPLOYMENT_TARGET=14.0`） | `README.md:17`、`scripts/build-dmg.sh` |
| Xcode | 15+ | `README.md:169` |
| 依赖 | `brew install re2 abseil` | `README.md:171-173` |
| C++ | clang++，C++20 | `Makefile:1-2` |
| 权限 | 完全磁盘访问（GUI 首次启动） | `README.md:163` |

## 构建/运行

```bash
# 1) 核心快速回归（最快，先跑通这个）
make test

# 2) GUI Release
make app
open build/Release/MacEverything.app

# 3) 无头 daemon
make daemon
./maceverything-daemon --port 19860 --root /

# 4) 桥接分页快照（不需要 Xcode 工程）
make test-bridge-snapshot
```

`main.cpp` 是最小闭环：扫描 → `loadRecords` → 交互查询（`main.cpp:25-69`）。它不启动 FSEvents，也不写 WAL，适合调查询逻辑。但仓库没有提供它的 Makefile target；如果要单独编译，照 `Makefile:1-10` 的 `CXXFLAGS`、`RE2_CFLAGS`、`RE2_LDFLAGS`、`-framework CoreServices` 把 `test_all.cpp` 换成 `main.cpp`，并先设置 `RE2_PREFIX`——直接一行 `clang++ MacEverything/Core/*.cpp main.cpp` 会链接失败。

## 测试/lint

```bash
make test                 # test_all --fast + lint-bridge
make test-slow            # 慢速集成：全盘扫描、FSEvents、端到端
make test-all             # 全部测试
make test-asan            # AddressSanitizer（--fast）
make test-tsan            # ThreadSanitizer（--fast）
make test-bridge-snapshot # ObjC++ 分页快照
```

`lint-bridge` 只做 `-fsyntax-only`，不会链接 AppKit（`Makefile:24-29`）；桥接改动至少跑一次 `make test-bridge-snapshot`。

测试文件 87 个，覆盖查询、持久化、WAL、FSEvents、内存优化、并发和桥接（`tests/`）。改核心逻辑时最小要求是 `make test`；改持久化加 `tests/test_flat_persistence_v6.h` / `tests/test_wal_crc.h` 相关用例；改并发加 `make test-tsan`。

`make` 的依赖关系要记住：`test` 依赖 `test_all` 和 `lint-bridge`，所以第一次会先编译整个核心；`test-asan` / `test-tsan` 各自编译独立二进制，不会复用 `test_all`；`make app` 走 Xcode 工程，和 Makefile 的 clang 编译是两套构建，改了 Core 文件后两边都要验证。`make clean` 只删根目录的测试二进制和 `build/`，不会清 Xcode DerivedData。

测试规模参考：1.4.0 之后 `make test-fast` 约 12,291 项通过（`docs/changelog/153`），`fix/rebuild-index-v6` 分支约 12,270 项（`docs/changelog/155-rebuild-index-discards-v6.md`，该文件只在分支上）。

## CI 矩阵

| 工作流 | 触发 | 矩阵 | 产物 |
|---|---|---|---|
| `.github/workflows/pr-build.yml` | `pull_request` | arm64 `macos-15` + x86_64 `macos-15-intel`，30 min 超时 | 两种架构的 DMG（仅验证能构建） |
| `.github/workflows/release.yml` | 推 `v*` tag 或手动指定 tag | 同上 + Ubuntu release job | DMG + `SHA256SUMS.txt` + GitHub Release |

CI 只构建 DMG，不跑 `make test`——**测试要在本地跑**。`pr-build.yml` 还缓存 `build/release-<arch>/deps`，key 是 `scripts/build-dmg.sh` 的哈希，所以改构建脚本会让缓存失效。

CI 的缺口要说清楚：`.github/workflows/pr-build.yml` 只验证“能构建出 DMG”，不跑任何单元测试；`.github/workflows/release.yml` 也只构建和发布。也就是说，PR 上的绿勾不等于逻辑正确，维护者仍需要本地 `make test-all`。如果要在 fork 里补 CI，最小改动是在 `.github/workflows/pr-build.yml` 加一个 `make test` 的 job，但 `test_all` 依赖 CoreServices 和 re2，runner 上要先装依赖。

## Issue/PR 规则

仓库没有 `CONTRIBUTING.md`，README 给出的流程是：

1. Fork 仓库；
2. 建 `feat/...` 或 `fix/...` 分支；
3. 为新功能写测试；
4. `make test-all` 通过；
5. 提 PR（`README.md:329-336`）。

`AGENTS.md` 额外要求：**每次更新必须同步 `MacEverything/App/AboutView.swift` 的版本说明 + `docs/changelog/` 记录 + `docs/changelog/README.md` 索引，并校验三者一致**。这条比 README 更硬，改版本/功能时别漏。实际例子可以看 `docs/changelog/153`、`154`：两者都明确写“版本号和构建号未修改（仍为 1.4.0，Build 4）”——说明修 bug 不一定要升版本，但 changelog 必须有。

## 5 个上手入口

| 入口 | 难度 | 第一个改动建议 |
|---|---|---|
| `main.cpp` | 低 | 加一个查询统计输出（候选数/耗时） |
| `tests/test_query_parser.h` | 低 | 补一个 tokenizer/parser 边界用例 |
| `MacEverything/Core/QueryTokenizer.h:163-182` 的过滤器白名单 | 低 | 注册一个已有 `QueryFilterParser` 支持的新名字 |
| `MacEverything/Core/SearchEngineAdvancedQuery.cpp` 的候选选择 | 中 | 给 `ext:` 多值加一个去重/排序测试 |
| `MacEverything/Core/ServiceEngine+FSEvents.cpp` 的 `collectFSEventMutations` | 中 | 补一个 rename 目录的回归测试 |

## PR 自查清单

提交前至少过一遍：改动是否只碰一个模块；是否为分支/边界/失败路径加了测试；是否跑了 `make test` 和受影响的专项（持久化跑 `tests/test_flat_persistence_v6.h`，并发跑 `make test-tsan`）；是否同步了 `docs/changelog/` 与 `docs/changelog/README.md`；是否误把调试日志、绝对路径、临时开关带进 diff。如果改的是查询语法，再补一个 `tests/test_query_parser.h` 的反例，确认非法输入不会崩溃。

提交信息沿用仓库风格：`feat: ...`、`fix: ...`、`ci: ...`、`refactor: ...`，正文写“为什么”而不是“改了什么”。PR 描述里附上复现命令、测试结果和已知限制。不要把多个不相关改动塞进一个 PR；这个仓库的历史分支通常只动一个模块（`fix/persist-content-settings` 的 3 点 diff 就是 7 files +76/−914，集中在一个主题）。

## 贡献前必须知道的坑

- **Makefile 不跟踪头文件依赖**：只改 `.h` 后 `make` 可能不重编；审计报告明确提到“Makefile 不跟踪头文件，单纯运行 make 不会重新编译”（`docs/audits/2026-10-22/batch-index-removal/report.md:39`）。改头文件后先 `make clean`，或者 `make -B test_all`。
- **版本多处硬编码**：`MacEverything/Info.plist:17-21` 是 1.4.0/Build 4，`MacEverything/App/AboutView.swift` 有版本说明，`MacEverything/Core/ServiceEngine.h:175` 的 `kAppVersion` 还是 `"1.1.0"`。改版本时别只改一处，也别把 `kAppVersion` 当唯一版本源。
- **不要用 `MallocLargeCache=0` 之外的方式测内存**：调试运行不读 `LSEnvironment`，内存数字会偏高（`docs/audits/2026-10-22/allocator-narrow-columns/report.md:11`）。daemon 走 `me::ensureMallocLargeCacheDisabled` 自 re-exec，GUI 走 `Info.plist` 的 `LSEnvironment`。
- **别在已合并分支上开发**：`claude/trusting-dirac-c373be`、`fix/persist-content-settings` 已经并入 main，落后 1–3 个提交；直接从 main 开新分支。
- **修改索引格式要升版本**：v6 读取器会校验 magic/version/header CRC/段边界（`MacEverything/Core/FlatIndexWriter.cpp:413-613`）；加 section 可以，但旧读取器要能跳过，且 `INODES`/`DEV_IDS` 这种“填 0 保留”的做法说明格式债会长期存在。
- **别指望 CI 帮你抓逻辑 bug**：CI 只构建，不测试（见上）。

**一句话记住：** 先跑 `make test`，再改一个能写测试的小口子；别一上来碰持久化格式和并发，也别相信 PR 上的绿勾。
