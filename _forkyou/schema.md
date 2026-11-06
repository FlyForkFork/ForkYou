# ForkYou 数据格式

## `meta.json`（每个项目）

```json
{
  "schema": 1,
  "id": "github:example-org/example-repo",
  "name": "example-repo",
  "provider": "github",
  "upstream": "example-org/example-repo",
  "fork": "example-org/example-repo",
  "category": "01-systems",
  "depth": "L2",
  "length": "default",
  "analyzed_commit": "546f65b2135e7a1491d2d743f0a1e072a74df36f",
  "analyzed_at": "2026-11-07T01:30:00+08:00",
  "upstream_url": "https://github.com/example-org/example-repo",
  "homepage": null,
  "license": "GPL-3.0-only",
  "stars": 123,
  "language": "Rust",
  "topics": ["kvm", "tauri"],
  "branches": ["main", "feature-x"],
  "docs": ["01-positioning.md", "..."],
  "guide": "guide.html",
  "sources": [{"title": "...", "url": "...", "date": "..."}]
}
```

必填：`id`、`name`、`provider`、`upstream`、`fork`、`category`、`depth`、`analyzed_commit`、`analyzed_at`、`upstream_url`、`license`、`branches`、`docs`、`guide`。

## `manifest.json`（仓库状态）

```json
{
  "schema": 1,
  "updated_at": "2026-11-07T01:30:00+08:00",
  "projects": {
    "github:example-org/example-repo": {
      "id": "github:example-org/example-repo",
      "name": "example-repo",
      "provider": "github",
      "upstream": "example-org/example-repo",
      "fork": "example-org/example-repo",
      "category": "01-systems",
      "path": "01-systems/example-repo",
      "status": "analyzed",
      "depth": "L2",
      "length": "default",
      "analyzed_commit": "546f65b...",
      "analyzed_at": "...",
      "upstream_commit": "546f65b...",
      "upstream_checked_at": "...",
      "branches": ["main", "feature-x"],
      "error": null
    }
  }
}
```

`status` 取值：`new` → `prepared` → `analyzed`；失败为 `failed`；跳过为 `skipped`。

## `guide.data.json`

```json
{
  "slug": "example-repo",
  "title": "example-repo",
  "subtitle": "一句话描述这个项目",
  "one_liner": "一句话",
  "category": "01-systems",
  "tags": ["Rust", "CLI"],
  "meta": {
    "upstream": "example-org/example-repo",
    "license": "GPL-3.0-only",
    "stars": 123,
    "language": "Rust",
    "commit": "546f65b...",
    "updated": "2026-11-06"
  },
  "links": {
    "github": "https://github.com/example-org/example-repo",
    "homepage": null,
    "docs": "https://github.com/example-org/example-repo#readme"
  },
  "stats": [
    {"label": "代码规模", "value": "1000 文件"},
    {"label": "语言", "value": "Rust + TypeScript"},
    {"label": "License", "value": "GPL-3.0-only"},
    {"label": "分支", "value": "2"}
  ],
  "mental_model": [
    {"title": "它是谁", "body": "..."},
    {"title": "怎么工作", "body": "..."},
    {"title": "为什么特别", "body": "..."}
  ],
  "architecture": {
    "title": "分层架构",
    "layers": [
      {"name": "接入层", "nodes": [{"id": "ui", "label": "UI", "desc": "..."}]},
      {"name": "核心层", "nodes": [{"id": "agent", "label": "Agent", "desc": "..."}]}
    ],
    "edges": [
      {"from": "ui", "to": "agent", "label": "IPC"}
    ]
  },
  "mechanism": {
    "title": "一次键鼠跨屏发生了什么",
    "steps": [
      {"title": "捕获", "detail": "...", "highlight": ["input"], "code": "..."}
    ]
  },
  "code_map": [
    {"path": "src/router.rs", "role": "路由状态机", "read_order": 1, "url": "https://github.com/..."}
  ],
  "run": [
    {"label": "构建", "command": "cargo build", "note": "..."}
  ],
  "branches": [
    {"name": "main", "purpose": "默认分支", "diff": "—", "url": "..."}
  ],
  "contribute": [
    {"title": "先读", "detail": "...", "url": "..."}
  ],
  "cheats": [
    {"q": "面试官问：它和 Synergy 有什么区别？", "a": "..."}
  ],
  "sources": [
    {"title": "README", "url": "...", "date": "2026-11-06"}
  ]
}
```

`architecture.layers[].nodes[]` 的 `id` 必须唯一；`mechanism.steps[].highlight` 引用这些 id。`edges` 可以跨层，也可以同层。没有的段可以省略，模板会自动隐藏。
