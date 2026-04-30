# Feature Spec: dedup — URL 去重

> URL 去重：内存去重 + DB 去重 + 插入幂等。

## 状态：已完成

## 数据依赖

- 读写 `bookmarks` 表的 url、is_duplicate、add_date 字段 → [models/bookmark.md](../models/bookmark.md)

---

## 两层去重机制

| 层级 | 时机 | 实现 | 作用 |
|------|------|------|------|
| 内存去重 | 导入时，写入 DB 前 | `deduplicateByUrl()` | 减少插入量 |
| DB 去重 | 导入后，手动调用 | `markDuplicates()` | 标记 DB 中已有的重复 |
| DB 幂等 | 插入时 | `INSERT OR IGNORE` | URL 已存在则跳过 |

---

## API 端点

### deduplicateByUrl(bookmarks) — 内存去重

| 项目 | 说明 |
|------|------|
| 入参 | `RawBookmark[]` |
| 出参 | `RawBookmark[]`（去重后） |
| 位置 | `src/importer/chrome-html.ts:95` |

### markDuplicates(db) — DB 去重

| 项目 | 说明 |
|------|------|
| 入参 | `Database` |
| 出参 | `number`（标记的重复数量） |
| 位置 | `src/db/repository.ts:154` |
| 注意 | **未被任何 CLI 命令调用** [需确认] 是否应暴露为 CLI 命令 |

---

## 内存去重逻辑

```typescript
// URL 相同时保留 add_date 更大（更新）的
if (b.add_date && existing.add_date && b.add_date > existing.add_date) {
  urlMap.set(b.url, b);
}
```

| 情况 | 结果 |
|------|------|
| 新条目 add_date > 旧条目 add_date | 替换为新条目 |
| 新条目 add_date <= 旧条目 add_date | 保留旧条目 |
| 新条目无 add_date，旧条目有 | 保留旧条目（`b.add_date` 为 falsy） |
| 旧条目无 add_date，新条目有 | 保留旧条目（`existing.add_date` 为 falsy） |
| 两者都无 add_date | 保留先出现的 |

[需确认] "两者都无 add_date 时保留先出现的" — 因为 `b.add_date && existing.add_date` 短路为 false，不替换。这是设计意图还是遗漏？

---

## DB 去重逻辑

```sql
UPDATE bookmarks SET is_duplicate = 1
WHERE id IN (
  SELECT b2.id FROM bookmarks b2
  INNER JOIN (
    SELECT url, MAX(add_date) as latest
    FROM bookmarks
    GROUP BY url
    HAVING COUNT(*) > 1
  ) dup ON b2.url = dup.url AND b2.add_date < dup.latest
)
```

| 步骤 | 说明 |
|------|------|
| 1 | 找出 URL 相同且数量 > 1 的组 |
| 2 | 每组中 `add_date < MAX(add_date)` 的标记为重复 |
| 3 | `add_date = MAX` 的那条保留 |

**与内存去重的差异**：

| 对比 | 内存去重 | DB 去重 |
|------|---------|--------|
| 时机 | 导入时 | 导入后（手动） |
| 动作 | 直接丢弃 | 标记 `is_duplicate=1`，记录保留 |
| 无 add_date 处理 | 保留先出现的 | `add_date < MAX` 中 NULL 不会被标记 [需确认] |
| 触发方式 | 自动（import 命令内） | 未暴露 CLI 命令 |

---

## DB 幂等插入

```sql
INSERT OR IGNORE INTO bookmarks (id, url, title, ...) VALUES (?, ?, ?, ...)
```

- URL 已存在 → 静默跳过，`result.changes = 0`
- 不区分"完全相同"和"仅 URL 相同"

---

## 验收标准

1. 内存去重：相同 URL 只保留 add_date 最新的一条
2. 内存去重：两者都无 add_date 时保留先出现的
3. DB 插入幂等：重复导入同一文件不产生重复记录
4. DB 去重：`markDuplicates` 正确标记 add_date 非最新的重复
5. DB 去重：每组重复中保留且仅保留一条非重复记录

---

## 已知问题

| 问题 | 说明 |
|------|------|
| `markDuplicates` 未暴露 | 函数存在但无 CLI 命令调用 [需确认] |
| URL 严格匹配 | `http://example.com` 和 `https://example.com` 视为不同 URL [需确认] 是否应标准化 |
| 无 add_date 边界 | 两个 NULL add_date 的重复记录，内存去重保留第一条，DB 去重不标记任一条 |
