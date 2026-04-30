# Feature Spec: scan — AI 打标签

> 两种模式：fast（标题+URL）和 deep（标题+URL+正文）。分批交替处理：每批检测链接 → AI 打标签。

## 状态：进行中

## 数据依赖

- 读写 `bookmarks` 表 → [models/bookmark.md](../models/bookmark.md)
- 依赖 [features/classify.md](classify.md)（自动分类）
- 依赖 [features/link-check.md](link-check.md)（死链检测，三态结果）
- 依赖 [features/link-check.md](link-check.md)（内容缓存，磁盘复用）
- 依赖 [features/cache.md](cache.md)（正文磁盘缓存管理）

---

## CLI 接口

```
bm scan [options]           # fast 模式（默认）
bm scan --deep [options]    # deep 模式
```

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--deep` | boolean | false | deep 模式：抓取正文 + AI 深度分析 |
| `-l, --limit <n>` | number | 无限制 | 本次处理的最大书签数 |
| `-s, --start <n>` | number | 0 | 跳过前 N 条（OFFSET） |
| `--force` | boolean | false | 重新处理已完成的书签 |
| `--category <cat>` | string | — | 按分类筛选（仅 deep 模式） |
| `--url <url>` | string | — | 指定单个 URL 处理（隐含 force=true） |

### Fast 模式查询逻辑

| 参数组合 | SQL WHERE 条件 |
|---------|---------------|
| 默认 | `status = 'pending'` |
| `--force` | `status != 'deep_done'` |
| `--url URL` | `status != 'deep_done'` + JS 端过滤 |

### Deep 模式查询逻辑

| 参数组合 | SQL WHERE 条件 |
|---------|---------------|
| 默认 | `status != 'deep_done'` |
| `--force` | `1=1`（所有书签） |
| `--category AI` | 追加 `AND category = 'AI'` |
| `--url URL` | `1=1` + JS 端过滤 |

---

## 处理流程

### 分批交替处理

书签按 10 条一批，每批内交替执行：链接检测 → 内容缓存 → AI 处理 → 写入 DB。中断时已处理批次不受影响。

### 域名穿插排序

分批前按域名轮询排序，使同一域名 URL 分散到不同批次，避免连续请求触发限流。

```
原始: [csdn-1, csdn-2, csdn-3, github-1, toutiao-1, csdn-4]
穿插: [csdn-1, github-1, toutiao-1, csdn-2, csdn-3, csdn-4]
```

### Fast 模式（每批）

```
缓存查找（每条书签）
│  DB content 非空 → pageData[id]，跳过请求
│  磁盘缓存 {id}.json → pageData[id]，跳过请求
│  无缓存 → 进入链接检测
    │
    ▼
checkLinks(非缓存 URLs)
│  alive → extractContent(html) → pageData[id] → cacheToDisk → 继续
│  dead → status='dead'，结束
│  error → status='error'，结束（可重试）
    │
    ▼
AI 打标签 (buildScanPrompt, 不含正文)
│  失败 → status='error'
│  成功 → tags[] + description + confidence + value_score
    │
    ▼
自动分类 (classify)
    │
    ▼
写入 DB (status=scan_done)
```

### Deep 模式（每批）

```
缓存查找（每条书签）
│  DB content 非空 → pageData[id]，跳过请求
│  磁盘缓存 {id}.json → pageData[id]，跳过请求
│  无缓存 → 进入链接检测
    │
    ▼
checkLinks(非缓存 URLs)
│  alive → extractContent(html) → pageData[id] → cacheToDisk → 继续
│  dead → status='dead'，结束
│  error → status='error'，结束
    │
    ▼
正文检查
│  pageData[id].content 非空 → 继续
│  无正文 → status='empty'，结束
    │
    ▼
AI 打标签 (buildDeepPrompt, 含正文)
│  失败 → status='error'
│  成功 → tags[] + summary + confidence + value_score
    │
    ▼
自动分类 (classify)
    │
    ▼
写入 DB (status=deep_done)
```

---

## API 端点

### runScan(options)

| 项目 | 说明 |
|------|------|
| 入参 | `{ config, settings, db, mode: 'fast' \| 'deep', limit?, offset?, force?, category?, url?, ids? }` |
| 出参 | `Promise<BatchResult>` — `{ success, failed, skipped, dead?, empty? }` |
| 批大小 | 10 条/批（`SCAN_BATCH_SIZE`） |

---

## 业务规则

### AI 设计原则

1. **AI 只打标签，不做分类**：分类由规则引擎决定，提示词不要求 AI 输出 category
2. **标签严格限定**：AI 必须从允许列表中选标签，不允许自创（`response-parser.ts` 过滤非法标签）
3. **批量处理**：单次提示词包含多条书签，AI 返回 JSON 数组

### AI 输出格式

fast 模式：
```json
[
  {"url": "https://...", "tags": ["Kotlin", "MVVM"], "confidence": 0.9, "description": "1-2句话描述", "value_score": 7}
]
```

Deep 模式：
```json
[
  {"url": "https://...", "tags": ["Kotlin", "MVVM", "Jetpack"], "confidence": 0.95, "summary": "2-5句话摘要", "value_score": 8}
]
```

### fast 与 deep 对比

| 项目 | fast | deep |
|------|------|------|
| AI 输入 | URL + 标题 | URL + 标题 + 正文（截断 3000 字） |
| AI 输出 | description（1-2 句） | summary（2-5 句） |
| 标签精度 | 基础 | 精细（更多标签） |
| 缓存行为 | 缓存正文到磁盘（AI 不感知） | 优先从磁盘缓存读取 |

### 提示词调优记录

| 问题 | 调整 |
|------|------|
| 博客首页被标为具体技术（如 Flutter） | Scan 提示词添加规则 #5：博客首页优先标"资源" |
| AI 推断用户画像影响标签 | 移除 profile 注入，profile 仅用于 `bm init` |
| 搜索引擎被标为 AI | 分类规则只保留 LLM/MCP 匹配 AI，不含泛标签"AI" |

### 链接检测三态分流

| 检测结果 | DB 状态 | 后续 |
|---------|---------|------|
| alive (200) | 不写状态，继续 | AI 处理 |
| dead (404/软404) | `status='dead'` | 结束 |
| error (521/403/超时) | `status='error'` | 结束，可重试 |

### 内容缓存

详见 [features/cache.md](cache.md)。快速扫描时缓存正文（AI 不感知），深度扫描时优先命中缓存。error 不缓存以便重试。

### 覆盖规则（deep 覆盖 fast）

| 字段 | deep 行为 |
|------|----------|
| tags | 覆盖 fast 结果 |
| confidence | 覆盖 |
| category | 覆盖（通过自动分类） |
| subcategory | 覆盖 |
| value_score | 覆盖 |
| ai_model | 覆盖 |
| status | 设为 `deep_done` |
| summary | 写入（fast 无此字段） |
| description | 保留 fast 结果（COALESCE） |
| content | 抓取成功时写入 |

---

## 计数逻辑

| 计数 | 定义 |
|------|------|
| success | AI 成功处理的书签数 |
| failed | AI 失败 + 链接检测 error 数 |
| dead | 死链书签数 |
| empty | 正文为空书签数（deep 模式） |
| skipped | batch 内 skipped |

---

## 日志输出

```
[INFO] Scanning 48 bookmarks (fast mode)...
[INFO] --- Batch 1/5 (10 bookmarks) ---
[INFO] [link-check] 200 ✓ https://example.com/article
[INFO] [link-check] 521 ⚠ error https://blog.csdn.net/...
[INFO] Dead link: https://example.com/gone
[INFO] [link-check] 404 ✗ dead https://example.com/old
[INFO] [AI] https://example.com/article → tags: ["typescript"], confidence: 0.9
```

---

## 验收标准

1. `bm scan` 默认 fast 模式，处理 `status='pending'` 的书签
2. `bm scan --deep` 处理 `status != 'deep_done'` 的书签
3. `--force` 时处理所有非 `deep_done` 的书签
4. 死链（404/软404）标记 `status='dead'`
5. 瞬时错误（521/超时）标记 `status='error'`，不缓存
6. Deep 正文为空标记 `status='empty'`
7. AI 失败标记 `status='error'`
8. `deep_done` 终态不被覆盖
9. 进程中断时已处理批次不受影响
10. `--url` 指定单个 URL，自动 force
11. 兼容：`bm deep` 等同于 `bm scan --deep`
12. 快速扫描 AI prompt 不含正文内容
13. 链接检测时缓存的正文可供深度扫描复用
