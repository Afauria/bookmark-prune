# Feature Spec: scan — AI 打标签

> 两种模式：fast（标题+URL）和 deep（标题+URL+正文）。用户通过参数筛选书签，默认只处理 pending，--force 处理全部。

## 状态：已完成

## 数据依赖

- 读写 `bookmarks` 表 → [models/bookmark.md](../models/bookmark.md)
- 依赖 [features/classify.md](classify.md)（自动分类）
- 依赖 [features/link-check.md](link-check.md)（死链检测，三态结果）
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
| `--status <status>` | string | — | 按状态筛选（pending/tagged/dead/error） |
| `--scan-mode <mode>` | string | — | 按 scan_mode 筛选（fast/deep） |
| `-l, --limit <n>` | number | 无限制 | 本次处理的最大书签数 |
| `-s, --start <n>` | number | 0 | 跳过前 N 条（OFFSET） |
| `--force` | boolean | false | 处理筛选集合中全部书签（跳过 dead） |
| `--category <cat>` | string | — | 按分类筛选 |
| `--url <url>` | string | — | 指定单个 URL 处理 |

### 筛选逻辑

**第一步：用户参数筛选出集合 S**

```sql
-- 基础查询
SELECT * FROM bookmarks
WHERE 1=1
  [AND status IN ('pending', 'tagged')]  -- 如果指定 --status
  [AND scan_mode = 'fast']               -- 如果指定 --scan-mode
  [AND category = ?]                     -- 如果指定 --category
  [AND url = ?]                          -- 如果指定 --url
LIMIT ? OFFSET ?
```

**第二步：从集合 S 中挑要处理的书签**

| 命令 | 处理范围 |
|------|---------|
| 无 `--force` | S 中 `status = 'pending'` 的 |
| 有 `--force` | S 中 `status != 'dead'` 的（即 pending + tagged + error）|

### 示例

```bash
# 默认：只处理 pending
bm scan

# 处理 pending 和 tagged 的（全部）
bm scan --force

# 处理 tagged 中 scan_mode=fast 的（升级为 deep）
bm scan --deep --status tagged --scan-mode fast

# 处理 AI 分类下的 pending
bm scan --category AI

# --force 处理 AI 分类下的全部（跳过 dead）
bm scan --deep --category AI --force
```

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

### 逐条书签处理流程

```
缓存查找（每条书签）
│  DB content 非空 → pageData[id]，跳过 HTTP
│  磁盘缓存 {id}.json → pageData[id]，跳过 HTTP
│  无缓存 → 进入链接检测
    │
    ▼
checkLinks(非缓存 URLs)
│  alive (200) → extractContent(html) → pageData[id] → cacheToDisk → 继续
│  dead (404/软404) → status='dead'，结束
│  error (521/403/超时) → status='error'，结束（可重试）
    │
    ▼
Deep 模式额外检查
│  content 非空 → 继续
│  content 为空 → 跳过，状态不变（下次可能正文可用）
    │
    ▼
AI 打标签
│  fast: buildScanPrompt，批量提交，返回 JSON 数组
│  deep: buildDeepPrompt，逐篇提交，返回单个 JSON 对象
│  失败 → status='error'
│  成功 → tags[] + summary(deep 仅有) + confidence + value_score
    │
    ▼
自动分类（classify，规则引擎）
│
▼
写入 DB
├─ status='tagged'
├─ scan_mode='fast'/'deep'
├─ summary（仅 deep，COALESCE 保留旧值）
└─ 其他字段（tags, category, confidence, value_score）
```

---

## API 端点

### runScan(options)

| 项目 | 说明 |
|------|------|
| 入参 | `{ config, settings, db, mode: 'fast' \| 'deep', limit?, offset?, force?, category?, url?, status?, scanMode? }` |
| 出参 | `Promise<BatchResult>` — `{ success, failed, skipped, dead, skippedDetails }` |
| 批大小 | 10 条/批（`SCAN_BATCH_SIZE`） |

### BatchResult

```typescript
{
  success: number;           // 成功处理的书签数
  failed: number;            // 失败的书签数（链接 error + AI 失败）
  skipped: number;           // 跳过的书签数（deep 无正文）
  dead: number;              // 死链书签数
  skippedDetails: Array<{    // 跳过详情
    id: string;
    url: string;
    reason: string;          // 'no_content' | 'dead' | 'error'
  }>;
}
```

---

## 业务规则

### AI 设计原则

1. **AI 只打标签，不做分类**：分类由规则引擎决定，提示词不要求 AI 输出 category
2. **标签严格限定**：AI 必须从允许列表中选标签，不允许自创（`response-parser.ts` 过滤非法标签）
3. **批量策略按模式区分**：
   - fast：单次提示词包含多条书签，AI 返回 JSON 数组（批大小由 `settings.ai.batch.size` 控制）
   - deep：逐篇提交，每次只含一条书签，AI 返回单个 JSON 对象。正文较长，多篇拼合易导致 AI 解析错误或截断

### AI 输出格式

fast 模式：
```json
[
  {"url": "https://...", "tags": ["Kotlin", "MVVM"], "confidence": 0.9, "value_score": 7}
]
```

Deep 模式（逐篇，返回单个对象）：
```json
{"url": "https://...", "tags": ["Kotlin", "MVVM", "Jetpack"], "confidence": 0.95, "summary": "2-5句话摘要", "value_score": 8}
```

### fast 与 deep 对比

| 项目 | fast | deep |
|------|------|------|
| AI 输入 | URL + 标题 | URL + 标题 + 正文（截断 3000 字） |
| AI 输出 | tags + category + confidence + value_score | 同上 + summary |
| 批量策略 | 多条拼合，AI 返回 JSON 数组 | 逐篇提交，AI 返回单个 JSON 对象 |
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

### Deep 模式无正文处理

- deep 模式发现无正文 → 跳过，状态不变，计入 `skipped` 和 `skippedDetails`
- 不标记 `empty` 状态，下次可能正文可用

### COALESCE 行为

- `summary`：使用 COALESCE，若新值为 null 则保留旧值
- 其他字段：直接覆盖

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
[INFO] [CLASSIFY] https://example.com/article → AI/Language
[INFO] Skipped (no content): https://example.com/empty-page
[INFO] Scan complete: success=35, failed=5, skipped=3, dead=5
[INFO] ┌─ Skipped details ───────────────────────────────┐
[INFO] │ https://example.com/empty-page → no content     │
[INFO] │ https://example.com/another-empty → no content  │
[INFO] │ https://example.com/third-empty → no content    │
[INFO] └─────────────────────────────────────────────────┘
```

---

## 验收标准

1. `bm scan` 默认 fast 模式，只处理 `status='pending'` 的书签
2. `bm scan --force` 处理筛选集合中全部非 dead 书签（pending + tagged + error）
3. `--status` 参数按状态筛选书签
4. `--scan-mode` 参数按 scan_mode 筛选书签
5. 死链（404/软404）标记 `status='dead'`，计入 `dead` 计数
6. 瞬时错误（521/超时）标记 `status='error'`，不缓存
7. Deep 正文为空跳过，状态不变，计入 `skipped` 和 `skippedDetails`
8. AI 失败标记 `status='error'`，计入 `failed` 计数
9. 进程中断时已处理批次不受影响
10. `--url` 指定单个 URL 处理
11. 兼容：`bm deep` 等同于 `bm scan --deep`
12. 快速扫描 AI prompt 不含正文内容
13. 链接检测时缓存的正文可供深度扫描复用
14. 扫描完成输出状态统计 + 跳过详情列表