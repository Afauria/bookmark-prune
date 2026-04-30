# Feature Spec: classify — 分类引擎 + 独立分类命令

> 规则分类引擎（纯函数）+ 批量分类管道（`runClassify`）+ CLI 命令 `bm classify`。

## 状态：进行中

## 数据依赖

- 读写 `bookmarks` 表的 tags、category、subcategory 字段 → [models/bookmark.md](../models/bookmark.md)
- 依赖 [features/config.md](config.md)（classification_rules + techTags）

---

## CLI 接口

```
bm classify [options]
```

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--force` | boolean | false | 重新分类所有书签（包括已有 category 的） |

**查询逻辑**：

| 参数 | SQL WHERE 条件 |
|------|---------------|
| 默认 | `category IS NULL` |
| `--force` | `1=1`（所有书签） |

---

## API 端点

### classify(bookmark, rules, techTags?)

纯函数，无副作用。被 scan 管道自动调用，也可被 `runClassify` 批量调用。

| 项目 | 说明 |
|------|------|
| 入参 | `bookmark: { url, title, tags }` — tags 为 JSON 字符串 |
|      | `rules: ClassificationRule[]` — 分类规则列表 |
|      | `techTags?: string[]` — 技术标签列表（用于 subcategory） |
| 出参 | `{ category: string, subcategory: string | null }` |
| 副作用 | 无 |

### runClassify(options)

批量分类管道，供 `bm classify` 命令调用。

| 项目 | 说明 |
|------|------|
| 入参 | `{ db, config }` — force 参数控制查询范围 |
| 出参 | `{ classified: number }` — 成功分类的书签数 |
| 副作用 | 更新 DB 中书签的 category、subcategory 字段 |

---

## 执行流程

### classify() 纯函数

```
解析 tags (JSON string → string[])
    │
    ▼
遍历 rules（从上到下，首条匹配生效）
    │
    ├─ 规则有 url_contains 或 title_contains？
    │    └─ 是 → URL/标题匹配
    │         匹配成功 → return { category, subcategory }
    │         subcategory = parsedTags 中第一个属于 techTags 的标签
    │
    ├─ 规则有 tag_contains？
    │    └─ 是 → 标签匹配
    │         parsedTags 与 tag_contains 有交集 → return { category, subcategory=交集标签 }
    │
    ├─ 规则有 default=true？
    │    └─ 是 → 兜底匹配
    │         return { category, subcategory = 第一个 techTag }
    │
    └─ 继续下一条规则

遍历结束无匹配 → return { category: '待分类', subcategory: null }
```

### runClassify() 管道

```
查询待分类书签
    │
    ▼
对每条书签:
  classify(url, title, tags) → { category, subcategory }
    │
    ▼
updateBookmark(category, subcategory)
│  不改 status
    │
    ▼
返回 { classified: N }
```

---

## 匹配逻辑

**核心原则**：AI 只负责打标签，分类由规则引擎决定。AI 输出不包含 category/subcategory，由 `classify()` 纯函数根据标签推导。

### URL/标题匹配 (url_contains / title_contains)

```typescript
// 同一规则内 url_contains 和 title_contains 是 OR 关系
if (url_contains 和 title_contains 都定义) → 任一匹配即成功
if (只定义了 url_contains) → url 匹配即成功
if (只定义了 title_contains) → title 匹配即成功
```

匹配方式：`bookmark.url.includes(s)` / `bookmark.title.includes(s)`，大小写敏感。

### 标签匹配 (tag_contains)

```typescript
matchedTag = parsedTags.find(t => matchTags.includes(t))
```

返回第一个匹配到的标签作为 subcategory。

### 默认匹配

`match.default === true` 时直接匹配，无条件。

---

## Subcategory 生成规则

| 匹配阶段 | subcategory 值 |
|---------|----------------|
| url/title 匹配 | parsedTags 中第一个属于 techTags 的标签，无则 null |
| tag_contains 匹配 | 触发匹配的那个标签 |
| Default | parsedTags 中第一个属于 techTags 的标签，无则 null |
| 无匹配 | null |

---

## 规则结构

```typescript
interface ClassificationRule {
  domain: string;          // 匹配时归属的分类名
  match: {
    url_contains?: string[];    // URL 包含任一字符串
    title_contains?: string[];  // 标题包含任一字符串
    tag_contains?: string[];    // 标签包含任一值
    default?: boolean;          // 兜底规则
  };
}
```

---

## 管道集成

**Scan 管道**：打标签后自动调用 `classify()` 为每条书签分配 category/subcategory。

**独立命令**：`bm classify` 批量运行分类，可用于：
- scan 前预分类（用 url/title 规则为无标签书签分配分类）
- 修改分类规则后重新分类
- 补充分类遗漏的书签

---

## 验收标准

1. 空规则列表 → 返回 `{ category: '待分类', subcategory: null }`
2. tags 为 `'[]'` 时，tag_contains 不匹配
3. `bm classify` 对 category IS NULL 的书签运行分类
4. `bm classify --force` 重新分类所有书签
5. classify 不改 status，只改 category + subcategory
6. scan 管道打标签后自动分类
