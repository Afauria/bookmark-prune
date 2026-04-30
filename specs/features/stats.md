# Feature Spec: stats — 数据库统计

> 数据库统计：总数、按状态分布、按分类分布。

## 状态：已完成

## 数据依赖

- 只读 `bookmarks` 表 → [models/bookmark.md](../models/bookmark.md)

---

## CLI 接口

```
bm stats
```

| 项目 | 说明 |
|------|------|
| 无参数 | — |
| 退出码 | 0=成功，1=DB 错误 |

---

## API 端点

### getStats(db)

| 项目 | 说明 |
|------|------|
| 入参 | `Database` |
| 出参 | `{ total: number, byStatus: Record<string, number>, byCategory: Record<string, number> }` |
| SQL | 3 次查询：COUNT总数、GROUP BY status、GROUP BY category |

### getPendingCount(db)

| 项目 | 说明 |
|------|------|
| 入参 | `Database` |
| 出参 | `number` |
| SQL | `SELECT COUNT(*) FROM bookmarks WHERE status = 'pending'` |
| 注意 | **未被 CLI 命令调用** [需确认] 是否应展示在 stats 输出中 |

---

## 输出格式

```
Total bookmarks: 3959

By status:
  pending: 3901
  scan_done: 58

By category:
  null: 3901 (98.5%)
  资源: 20 (0.5%)
  DevOps: 15 (0.4%)
  待分类: 10 (0.3%)
  ...
```

### 排序规则

- **By status**：按 SQL `GROUP BY` 返回顺序（不确定） [需确认] 是否应固定排序
- **By category**：按数量降序（`sort(([, a], [, b]) => b - a)`）

### category 为 null 时的显示

```typescript
byCategory[row.category ?? 'null'] = row.count;
```

数据库中 `category IS NULL` 的书签在输出中显示为字符串 `"null"`，百分比基于总数计算。

---

## 验收标准

1. total 等于 bookmarks 表的总行数
2. byStatus 的各值之和等于 total
3. byCategory 的各值之和等于 total
4. category 按 count 降序排列
5. 百分比保留 1 位小数
6. 无书签时 total=0，byStatus/byCategory 为空对象

---

## 缺失项

| 项目 | 说明 |
|------|------|
| 死链统计 | 未单独统计 `status='dead'` 的数量 |
| 去重统计 | 未展示 `is_duplicate=1` 的数量 |
| `getPendingCount` | 函数存在但未使用 |
| 按文件夹统计 | 未展示 `original_folder` 分布 |
| 输出语言 | 标题用英文（"Total bookmarks"），状态/分类用中文，不统一 [需确认] |
