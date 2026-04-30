# 架构设计

> 技术选型、目录结构、模块依赖、数据流。

---

## 技术选型

| 决策 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript (strict) | 类型安全，CLI 工具生态成熟 |
| 运行时 | Node.js >= 22 | 原生 fetch，ESM 稳定支持 |
| 数据库 | SQLite (better-sqlite3) | 零配置本地存储，同步 API 适合 CLI |
| CLI | Commander | 轻量，成熟 |
| AI 调用 | 原生 fetch | 不绑定 SDK，支持任意 OpenAI/Anthropic 兼容端点 |
| HTML 解析 | node-html-parser | 轻量，Chrome 书签结构简单 |
| 正文提取 | @mozilla/readability + jsdom | 标准正文提取方案 |
| 配置 | YAML (eemeli) | 完整 YAML 1.2，支持多行字符串 |

---

## 目录结构

```
src/
├── index.ts                # CLI 入口，commander 命令定义
├── types.ts                # 所有 TypeScript 类型（唯一类型来源）
├── config/                 # 配置层
│   ├── loader.ts           # config.yaml + settings.yaml + .env 加载
│   └── prompts.ts          # 提示词模板加载 + 变量注入
├── db/                     # 数据层
│   ├── database.ts         # SQLite 连接初始化（WAL 模式）
│   ├── schema.ts           # DDL（CREATE TABLE/INDEX）
│   └── repository.ts       # CRUD 操作（唯一数据访问层）
├── importer/               # 导入层
│   └── chrome-html.ts      # Chrome 书签 HTML 解析
├── pipeline/               # 管道层
│   ├── classifier.ts       # 规则分类引擎 + 独立 classify 命令
│   ├── scanner.ts          # Scan 管道（fast/deep 模式）
│   └── link-checker.ts     # 共享死链检测（runLinkCheck）
├── ai/                     # AI 层
│   ├── provider.ts         # AIProvider 接口 + 工厂函数
│   ├── anthropic.ts        # Anthropic 适配器（含 base_url 覆盖）
│   ├── openai.ts           # OpenAI 兼容适配器
│   ├── ollama.ts           # Ollama 本地适配器
│   ├── response-parser.ts  # AI 响应 JSON 解析 + 标签校验
│   └── batch.ts            # 批处理（分块 + 并发 + 重试）
├── crawler/                # 爬虫层
│   ├── link-checker.ts     # 死链检测 + 重定向修复
│   └── content-fetcher.ts  # URL 抓取 + Readability 正文提取 + 磁盘缓存
└── utils/                  # 工具层
    ├── logger.ts           # 日志（info/warn/error）
    └── progress.ts         # 进度报告（速率 + ETA）
```

---

## 系统架构图

```
┌─────────────────────────────────────────────────────┐
│                    CLI (index.ts)                     │
│  import    scan    deep    stats                      │
└──────┬──────┬──────┬──────┬──────────────────────────┘
       │      │      │      │
       ▼      ▼      ▼      ▼
  ┌────────┐ ┌──────────────┐ ┌─────┐
  │importer│ │   pipeline   │ │  db │
  │        │ │scanner/deep  │ │repo │
  └────┬───┘ └──┬───────┬───┘ └──┬──┘
       │        │       │        │
       │        ▼       ▼        │
       │   ┌────────┐ ┌──────┐  │
       │   │classify│ │crawler│  │
       │   │(纯函数) │ │link-ck│  │
       │   └────────┘ │content│  │
       │              └──┬───┘  │
       │                 │      │
       │        ▼        ▼      │
       │   ┌─────────────────┐  │
       │   │     ai/         │  │
       │   │ provider+batch  │  │
       │   │ response-parser │  │
       │   └─────────────────┘  │
       │                        │
       ▼         ┌──────────┐   ▼
    ┌──────┐     │  config  │  ┌──────┐
    │chrome│     │loader+   │  │SQLite│
    │html  │     │prompts   │  │(WAL) │
    └──────┘     └──────────┘  └──────┘
```

---

## 模块依赖规则

| 模块 | 可依赖 | 不可依赖 |
|------|--------|---------|
| `utils/` | 无 | 其他所有模块 |
| `types.ts` | 无 | 其他所有模块 |
| `db/` | `types.ts` | pipeline, ai, crawler |
| `config/` | `types.ts` | pipeline, ai, db |
| `ai/` | `types.ts`, `utils/` | pipeline, db, crawler |
| `crawler/` | `types.ts`, `utils/` | pipeline, ai, db |
| `pipeline/` | 所有模块 | — |
| `index.ts` | 所有模块 | — |

**核心约束**：
- `pipeline/` 是编排层，可依赖所有模块
- `db/` 是纯数据层，不依赖业务逻辑
- `ai/` 不知道 pipeline 的存在
- `crawler/` 不知道 ai 的存在
- `classifier.ts` 是纯函数，无副作用，不依赖 DB 或 AI

---

## 数据流

### Scan 数据流（分批交替，每批 10 条）

```
DB (pending bookmarks)
  → 域名穿插排序
  → 分批循环（10 条/批）:
      link-checker (三态: alive/dead/error + 返回 HTML)
      │  dead → status='dead'
      │  error → status='error'
      │  alive → extractContent → 磁盘缓存
      → prompts (scan: 不含正文)
      → AI Provider (批量打标签)
      → response-parser (解析 + 校验)
      → classifier (自动分类)
      → DB (更新 status=scan_done)
```

### Deep 数据流（分批交替，每批 10 条）

```
DB (非 deep_done bookmarks)
  → 域名穿插排序
  → 分批循环（10 条/批）:
      link-checker (alive + HTML)
      → 内容获取（优先级: DB字段 > 链接检测HTML > 磁盘缓存 > HTTP请求）
      │  无正文 → status='empty'
      → prompts (deep: 含正文)
      → AI Provider (深度分析)
      → response-parser (解析 + 校验)
      → classifier (自动分类)
      → DB (更新 status=deep_done, 覆盖 scan 结果)
```
