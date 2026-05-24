# 项目总览

> bookmark-prune — 书签整理 CLI

---

## 设计原则

- **SDD 文档驱动**：Spec 是唯一事实来源，先改 Spec 再改代码
- **AI 可配置**：支持 OpenAI / Anthropic / Ollama / Gemini，配置切换
- **轻量可扩展**：原生 fetch 无 SDK，规则引擎驱动分类
- **数据本地化**：SQLite 存储，磁盘缓存，数据不离开本机

---

## 核心需求

1. **批量整理**：导入 Chrome 书签 → AI 打标签 → 规则引擎自动分类 → 4 状态管理 → SQLite 存储
2. **知识沉淀**：对选定书签抓取正文 → AI 深度分析 → 生成摘要 → 覆盖扫描结果
3. **书签维护**：死链检测、正文为空检测、重定向追溯、回收站管理

### 双模式处理

**快速扫描**：标题 + URL → AI 标签 + 规则分类 + 置信度

**深度解析**：标题 + URL + 全文 → AI 精细标签 + 摘要 + 价值评分（逐篇提交）

**覆盖规则**：deep 可覆盖 fast 结果，通过 `scan_mode` 字段区分。deep 抓不到正文时跳过，不降级到 fast。

### AI 集成

每种模式只调一次 AI，一次性输出全部结果。AI 只负责打标签和生成描述/摘要，分类由规则引擎推导。

| 模式 | 输入 | AI 输出 |
|------|------|---------|
| fast | 标题 + URL | tags + confidence + value_score |
| deep | 标题 + URL + 全文 | tags(精细) + summary + confidence + value_score |

### 分类引擎

4 阶段规则引擎（Pre-AI → AI 标签 → Post-AI → 兜底），分类由规则驱动，不硬编码。详见 [features/classify.md](features/classify.md)。

### 错误处理

4 层分层策略：AI 层 → 爬虫层 → 管道层 → CLI 层。支持断点续跑和指数退避重试。Ctrl+C 后已处理数据已持久化到 SQLite，再次运行自动跳过。

---

## 技术栈

| 类别 | 选型 | 版本 |
|------|------|------|
| 语言 | TypeScript | 6.x (strict) |
| 运行时 | Node.js | >= 22.0.0 |
| 数据库 | SQLite (better-sqlite3) | ^12.9.0 |
| CLI 框架 | Commander | ^14.0.3 |
| HTML 解析 | node-html-parser | ^7.1.0 |
| 正文提取 | @mozilla/readability + jsdom | ^0.6.0 / ^29.0.2 |
| 配置解析 | yaml (eemeli) | ^2.8.3 |
| AI 调用 | 原生 fetch（无 SDK） | — |
| 测试 | Vitest | ^4.1.5 |
| 开发运行 | tsx | ^4.21.0 |
| 前端开发 | Vite | ^8.0.10 |

---

## 模块清单

| 模块 | 路径 | 状态 | 说明 |
|------|------|------|------|
| CLI 入口 | `src/index.ts` | ✅ | import / scan / deep / classify / stats / check-links / ui |
| 类型定义 | `src/types.ts` | ✅ | 所有接口集中定义 |
| 配置加载 | `src/config/` | ✅ | YAML + .env + 环境变量展开 + 提示词渲染 |
| 数据库 | `src/db/` | ✅ | SQLite WAL，repository 模式 |
| Chrome 导入 | `src/importer/` | ✅ | HTML 解析 + URL 去重 |
| 分类引擎 | `src/pipeline/classifier.ts` | ✅ | 规则分类 + 独立 classify 命令 |
| Scan 管道 | `src/pipeline/scanner.ts` | ✅ | 缓存优先：DB → 磁盘 → HTTP → 提取 → AI |
| AI Provider | `src/ai/` | ✅ | 4 个适配器 + 批处理 + 响应解析 |
| 死链检测 | `src/crawler/link-checker.ts` | ✅ | 三态结果 + 软404 + 域名分组串行 |
| 正文抓取 | `src/crawler/content-fetcher.ts` | ✅ | Readability + 按书签 ID 磁盘缓存 |
| 进度报告 | `src/utils/progress.ts` | ✅ | 速率 + ETA |
| Web UI | `src/ui/server.ts` + `ui/` | ✅ | Vite HMR + API 代理 |
| 配置生成 | — | ❌ | `bm init` 命令 |
| 导出功能 | — | ❌ | Markdown / JSON 导出 |

---

## CLI 命令

```
bm [options] [command]

Options:
  -V, --version   版本号
  -h, --help      帮助信息
```

**退出码**：0=成功，1=失败（错误信息输出到 stderr）

| 命令 | 功能 | 详细 Spec |
|------|------|----------|
| `bm import -i <path>` | 导入 Chrome 书签 | [features/import.md](features/import.md) |
| `bm scan [options]` | AI 打标签（默认 fast，--deep 为深度） | [features/scan.md](features/scan.md) |
| `bm deep [options]` | 兼容别名，等同 `bm scan --deep` | [features/scan.md](features/scan.md) |
| `bm classify` | 独立规则分类 | [features/classify.md](features/classify.md) |
| `bm stats` | 数据库统计 | [features/stats.md](features/stats.md) |
| `bm check-links` | 死链检测 | [features/check-links.md](features/check-links.md) |
| `bm ui` | 启动 Web UI | [features/ui.md](features/ui.md) |

---

## SDD 文档结构

```
specs/
├── overview.md              # 本文件
├── architecture.md          # 架构设计 + 数据流
├── features/                # 功能 Spec
│   ├── import.md            # Chrome 导入
│   ├── scan.md              # Scan/Deep 管道
│   ├── classify.md          # 分类引擎
│   ├── config.md            # 配置加载 + 提示词
│   ├── link-check.md        # 死链检测
│   ├── cache.md             # 内容磁盘缓存
│   ├── check-links.md       # 独立死链检测命令
│   ├── dedup.md             # URL 去重
│   ├── stats.md             # 数据库统计
│   ├── ui.md                # Web UI
│   ├── init.md              # 配置生成（未实现）
│   └── export.md            # 导出功能（未实现）
└── models/
    └── bookmark.md          # 数据模型
```

开发流程：写 Spec → 写配置 → 写代码 → 小样本验证 → 调优 → 全量运行。
