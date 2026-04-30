# Model: Bookmark

> 数据模型定义，源码对应 `src/db/schema.ts` 和 `src/types.ts`。

---

## 表：bookmarks

### DDL（实际建表语句）

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  original_url TEXT DEFAULT NULL,
  title TEXT NOT NULL DEFAULT '',
  original_folder TEXT DEFAULT '',
  add_date INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','scan_done','deep_done','error','dead','empty')),
  confidence REAL,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  description TEXT,
  summary TEXT,
  tags TEXT DEFAULT '[]',
  category TEXT,
  subcategory TEXT,
  notes TEXT,
  value_score INTEGER,
  ai_model TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 索引

```sql
CREATE INDEX idx_bookmarks_status ON bookmarks(status);
CREATE INDEX idx_bookmarks_url ON bookmarks(url);
CREATE INDEX idx_bookmarks_category ON bookmarks(category);
```

---

## 字段详情

| 字段 | 类型 | 约束 | 来源 | 说明 |
|------|------|------|------|------|
| id | TEXT | PK | `uuid v4` | 导入时生成 |
| url | TEXT | NOT NULL | Chrome HTML `<A href>` | 重定向时会被 link-checker 更新，原 URL 保留在 original_url |
| original_url | TEXT | DEFAULT NULL | link-checker | 首次重定向时保存原始 URL，便于追溯 |
| title | TEXT | NOT NULL DEFAULT '' | Chrome HTML `<A>` 文本 | |
| original_folder | TEXT | DEFAULT '' | Chrome HTML `<H3>` + `<DL>` 路径 | 递归拼接文件夹名 |
| add_date | INTEGER | | Chrome HTML `ADD_DATE` 属性 | Unix 时间戳（秒） |
| status | TEXT | NOT NULL DEFAULT 'pending' | 管道状态机 | CHECK 约束 6 种值 |
| confidence | REAL | | AI 输出 | 0-1，默认 0.5（response-parser 兜底） |
| is_duplicate | INTEGER | NOT NULL DEFAULT 0 | `markDuplicates()` | URL 去重，保留最新 add_date |
| content | TEXT | | content-fetcher | 正文纯文本，缓存到磁盘 |
| description | TEXT | | fast AI 输出 | 1-2 句描述，基于标题+URL |
| summary | TEXT | | deep AI 输出 | 2-5 句摘要，基于正文 |
| tags | TEXT | DEFAULT '[]' | AI 输出 | JSON 字符串数组 |
| category | TEXT | | classifier | 一级分类（规则引擎推导） |
| subcategory | TEXT | | classifier | 匹配的技术标签名 |
| notes | TEXT | | [未实现] | 用户笔记 |
| value_score | INTEGER | | AI 输出 | 1-10，response-parser 截断 |
| ai_model | TEXT | | settings.yaml | 处理时使用的模型名 |
| processed_at | TEXT | | 管道 | ISO 8601 时间戳 |
| created_at | TEXT | NOT NULL | 导入时 | ISO 8601 |
| updated_at | TEXT | NOT NULL | 每次更新 | ISO 8601，repository 自动维护 |

---

## 状态机

```
                    ┌───────────┐
                    │  pending  │
                    └─────┬─────┘
                          │
     ┌─────────┬──────────┼──────────┬─────────┐
     ▼         ▼          ▼          ▼         ▼
┌──────────┐ ┌────────┐ ┌────┐ ┌────────┐ ┌───────┐
│scan_done │ │deep_done│ │dead│ │ error  │ │ empty │
└────┬─────┘ └────────┘ └────┘ └───┬────┘ └───────┘
     │        终态              │
     ▼                     --force
┌──────────┐              可重处理
│deep_done │
└──────────┘
```

| 转换 | 触发条件 |
|------|---------|
| pending → scan_done | fast 扫描成功 |
| pending → deep_done | deep 扫描成功 |
| pending → dead | 死链检测失败 |
| pending → empty | deep 正文为空 |
| pending → error | AI 失败（重试耗尽） |
| scan_done → deep_done | deep 扫描成功升级 |
| scan_done → dead | 重新扫描发现死链 |
| scan_done → empty | 重新 deep 正文为空 |
| scan_done → error | 重新扫描 AI 失败 |
| error → scan_done/deep_done | `--force` 重新处理成功 |

**核心约束**：
- `deep_done` 是终态，scan 管道永远跳过 `deep_done` 的书签
- `dead` / `empty` / `error` 可被 `--force` 重新处理
- 每步失败立即写入对应状态，中断不更新

**状态含义**：

| 状态 | 含义 | 可恢复 |
|------|------|--------|
| `pending` | 未处理 | — |
| `scan_done` | fast 扫描完成 | 可升级为 deep_done |
| `deep_done` | deep 扫描完成（终态） | 不可覆盖 |
| `dead` | 链接不可访问 | --force |
| `empty` | 链接存活但正文为空 | --force |
| `error` | AI 处理失败 | --force |

---

## TypeScript 对应

`src/types.ts` 中的 `Bookmark` 接口与表结构一一对应，唯一差异：

| TS 类型 | SQLite 类型 | 注意 |
|---------|------------|------|
| `is_duplicate: boolean` | `INTEGER` | TS 用 boolean，入库时自动转换 |
| `tags: string` | `TEXT` | JSON 字符串，需手动 parse/stringify |
| `add_date: number \| null` | `INTEGER` | Unix 秒级时间戳 |

---

## 缺失项 [需确认]

| 项目 | 说明 |
|------|------|
| is_duplicate 索引 | 旧 schema 有 `idx_bookmarks_is_duplicate`，当前 schema.ts 中已移除 [需确认] 是否仍需要 |
| notes 字段 | 表中存在但无任何代码使用 [需确认] 是否在 P1/P2 规划中 |
