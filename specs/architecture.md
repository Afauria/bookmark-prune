# 架构设计

> 技术选型、目录结构、模块依赖、数据流。

---

## 技术选型

| 决策 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript (strict) | 类型安全，CLI 工具生态成熟 |
| 运行时 | Node.js >= 22 | 原生 fetch，ESM 绑定支持 |
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
│   └── scanner.ts          # Scan 管道（fast/deep 模式）
├── crawler/                # 爬虫层
│   ├── link-checker.ts     # 共享死链检测（runLinkCheck）
│   └── content-fetcher.ts  # URL 抓取 + Readability 正文提取 + 磁盘缓存
├── ai/                     # AI 层
│   ├── provider.ts         # AIProvider 接口 + 工厂函数
│   ├── anthropic.ts        # Anthropic 适配器（含 base_url 覆盖）
│   ├── openai.ts           # OpenAI 兼容适配器
│   ├── ollama.ts           # Ollama 本地适配器
│   ├── response-parser.ts  # AI 响应 JSON 解析 + 标签校验
│   └── batch.ts            # 批处理（分块 + 并发 + 重试）
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
   │        │ │scanner/deep │ │repo │
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
        │   ┌─────────────────┐ │
        │   │     ai/         │ │
        │   │ provider+batch │ │ │
        │   │ response-parser │ │
        │   └─────────────────┘ │
        │                        │
        ▼         ┌───────────┐   ▼
    ┌──────┐     │  config  │ ┌──────┐
    │chrome│     │loader+   │ │SQLite│
    │html │     │prompts   │ │(WAL) │
    └──────┘     └──────────┘ └──────┘
```

---

## 模块依赖规则

| 模块 | 可依赖 | 不可依赖 |
|------|--------|---------|
| `utils/` | 无 | 其他所有模块 |
| `types.ts` | 无 | 其他所有模块 |
| `db/` | `types.ts` | pipeline, ai, crawler |
| `config/` | `types.ts` | pipeline, ai, db |
| `ai/` | `types.ts`, `utils` | pipeline, db, crawler |
| `crawler/` | `types.ts`, `utils` | pipeline, ai, db |
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
DB (筛选集合 S)
  ├─ 无 --force → S.filter(b => b.status === 'pending')
  └─ 有 --force → S.filter(b => b.status !== 'dead')
  → 域名穿插排序
  → 分批循环（10 条/批）:
      link-checker (三态: alive/dead/error + 返回 HTML)
      │  dead → status='dead', 计入 skippedDetails
      │  error → status='error', 计入 skippedDetails
      │  alive → extractContent → 检查 DB 内容 + 磁盘缓存
      │  无缓存 → 提取 HTML → pageData → cacheToDisk → 写入 DB
      → deep 模式: 无正文 → 跳过, 状态不变, 计入 skippedDetails
      │  有正文 → 继续
      → prompts (fast: 不含正文; deep: 含正文)
      → AI Provider (fast: 批量; deep: 逐篇)
      → response-parser (解析 + 校验)
      → classifier (自动分类)
      → DB (status='tagged', scan_mode='fast'/'deep', summary COALESCE)
      → 输出统计: success/failed/skipped/dead + skippedDetails
```

### Deep 数据流（分批交替，每批 10 条）

```
DB (筛选集合 S: --status tagged, --scan-mode fast)
  ── 无 --force → S.filter(b => b.status === 'tagged' AND b.scan_mode === 'fast')
  └─ 有 --force → S.filter(b => b.status !== 'dead')
  → 域名穿插排序
  → 分批循环（10 条/批）:
      link-checker (alive + HTML)
      │  已有 DB content → 跳过 HTTP
      │  磁盘缓存命中 → 跳过 HTTP
      │  HTTP → extractContent → pageData → cacheToDisk → 写入 DB
      │  dead → status='dead', 计入 skippedDetails
      │  error → status='error', 计入 skippedDetails
      │  alive → 检查正文
      │  │  无正文 → 跳过, status 不变, 计入 skippedDetails
      │  │ 有正文 → 继续
      │ prompts (deep: 含正文, 逐篇提交)
      → AI Provider (深度分析, 逐篇)
      → response-parser (解析 + 校验)
      → classifier (自动分类)
      → DB (status='tagged', scan_mode='deep', 覆盖 fast 结果, summary COALESCE)
      → 输出统计: success/failed/skipped/dead + skippedDetails
```