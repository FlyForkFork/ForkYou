# 09 运维：部署、配置、故障

> 这篇回答：怎么装、怎么配、坏了怎么查。

## 安装/部署

没有安装、没有构建、没有后端：

```bash
# 方式 1：直接打开
# 双击 index.html

# 方式 2：静态服务器（推荐，避免 file:// 的某些限制）
python -m http.server 8000
# http://localhost:8000/index.html
```

部署到 GitHub Pages / Nginx / 任意静态托管：把 `index.html` 放到站点根目录即可。没有环境变量、数据库、端口或服务端进程。

## 配置项

URL 参数由 `QC` 解析（`index.html:6202`）：

| 参数 | 作用 | 示例 |
|---|---|---|
| `q` | 画质档位：`test/low/medium/high/ultra` | `?q=low` |
| `tex` | 覆盖纹理尺寸（会被 `Gg` 限制到 1024 基础/2048 hero） | `?tex=512` |
| `wet` | 地面湿度覆盖 | `?wet=0` |
| `autostart` | 跳过标题直接开始 | `?autostart=1` |
| `noaudio` | 关闭音频 | `?noaudio=1` |
| `bench` | 基准测试（需非空值，或 `#bench`） | `?bench=1` |
| `seed` | 随机种子 | `?seed=4207` |
| `cam` | 固定机位（调试） | `?cam=0,2,10,0,1,0` |
| `fov` | 覆盖相机 FOV | `?fov=80` |
| `dt` | 固定时间步（调试） | `?dt=0.016` |
| `shot` | 截图模式（test 画质） | `?shot=1` |
| `show` | 只渲染指定模块（如 `render`） | `?show=render` |
| `noweapon` | 隐藏武器（截图） | `?noweapon=1` |

持久设置存在 `localStorage` 的 `saltline.settings.v1`；清掉它可恢复默认。

## 数据/日志/端口

- **数据**：没有服务端数据；设置只在本机 `localStorage`。
- **日志**：控制台有 `[boot]`、`[render]`、`[mats]`、`[level]`、`[audio]` 等前缀；启动错误写入 `window.__errors`，致命错误显示在 `#fatal`（`index.html:6202`）。
- **端口**：无；静态服务器默认 8000 只是示例。
- **网络**：运行时不请求外部资源；唯一 URL 是 `http://www.w3.org/1999/xhtml` 命名空间（不是网络请求）。

## 资源需求

| 资源 | 需求 |
|---|---|
| 浏览器 | WebGL2；建议桌面 Chrome/Edge/Firefox/Safari 新版本 |
| GPU | 独显/集显均可，后处理链对 fill-rate 敏感 |
| 显存 | high 档纹理估算 137.7 MB；ultra 约 185.9 MB（不含 render target/shadow） |
| 内存 | 1.4 MB 文本 + 场景几何 + PCM 缓冲；远低于纹理显存 |
| 磁盘 | 1.4 MB |
| 音频 | 需要用户手势后才能启动 WebAudio（浏览器自动播放策略） |

## 可观测性

- `window.__stats()`：FPS、state、render stats（`index.html:6202`）。
- `?bench=1`：30 秒采样，输出 avg/p99/median、GPU、buffer、quality、draw calls、tris（`index.html:6202`）。
- `window.__errors`：启动/模块错误数组（`index.html:6202`）。
- `#fatal`：致命错误覆盖层。
- 控制台 `[mats] unknown material` / `[mats] texture set failed`：材质表问题（`index.html:5453`）。

## 故障模式

| 现象 | 可能原因 | 排查 |
|---|---|---|
| 黑屏，只有加载条 | WebGL2 不支持 / GPU 被禁用 | 打开 `chrome://gpu`；换浏览器；看 `#fatal` 与 `window.__errors` |
| 启动即报 shader 错误 | 后处理/材质 shader 编译失败 | 看控制台第一条 `[render]`/`[mats]`；`Hg` 会自动回退 forward（`index.html:4744`） |
| 画面正常但很卡 | 后处理 fill-rate / 阴影 / 纹理生成 | `?q=low`；`?tex=512`；关闭浏览器高 DPI 缩放 |
| 首次进游戏卡一下 | 材质按需烘焙 | 正常现象；`Gg` 默认不 prewarm；可提前 `prewarm()`（需改代码） |
| 没有声音 | 自动播放策略 / `?noaudio=1` | 先点击页面；检查 URL；看 `[audio]` 日志 |
| 设置不生效 | `localStorage` 旧值覆盖 | 清 `saltline.settings.v1`；检查 URL 参数优先级 |
| 移动端过热/掉帧 | 后处理 + 高 DPI | `?q=low`；降低系统亮度/关闭省电模式 |
| 纹理内存高 | high/ultra 档 1024/2048 | `?tex=512` 或 `?q=medium`；`window.__stats().textureMB` |

## 升级/回滚

- **升级**：替换 `index.html`；没有迁移脚本、没有数据库 schema。
- **回滚**：保留上一个 `index.html` 或 Git commit；直接覆盖即可。
- **设置兼容**：`saltline.settings.v1` 是唯一持久状态；字段变更时旧值可能被忽略，不会阻塞启动。
- **缓存**：静态服务器可能缓存 HTML；用版本化文件名（如 `index-v2.html`）或 `Cache-Control: no-cache` 避免旧版本。

**一句话记住：** 运维这个项目只需要“一个静态文件 + 一个能跑 WebGL2 的浏览器”；故障排查的顺序是控制台 → 画质档位 → 纹理/后处理开关。
