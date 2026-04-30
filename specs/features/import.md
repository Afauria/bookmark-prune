# Feature Spec: import — Chrome 书签导入

> Chrome 书签 HTML 解析、URL 去重、数据库写入。

## 状态：已完成

## 数据依赖

- 写入 `bookmarks` 表 → [models/bookmark.md](../models/bookmark.md)

---

## CLI 接口

```
bm import -i <path>
```

| 项目 | 说明 |
|------|------|
| 必填参数 | `-i, --input <path>` — Chrome 导出的 bookmarks.html 文件路径 |
| 无可选参数 | — |
| 退出码 | 0=成功，1=文件不存在/解析失败 |

---

## 处理流程

```
读取 HTML 文件 (fs.readFileSync, UTF-8)
    │
    ▼
解析 Netscape Bookmark HTML (node-html-parser)
│  递归遍历 <DL> → <DT> → <H3>(文件夹) / <A>(书签)
│  提取: href, textContent, ADD_DATE 属性
│  跳过无效 URL: javascript:, place:, data:, about:, 空字符串
│  空标题时: 用 URL 的 hostname 替代
    │
    ▼
URL 去重 (内存去重)
│  相同 URL 保留 add_date 最新的一条
│  两条都无 add_date → 保留先出现的 [需确认] 是否为设计意图
    │
    ▼
写入 SQLite (INSERT OR IGNORE)
│  每条生成 UUID v4
│  status = 'pending', tags = '[]', is_duplicate = false
│  已存在的 URL (INSERT OR IGNORE) 不插入
    │
    ▼
输出统计日志
```

---

## API 端点

### parseChromeBookmarks(htmlFilePath)

| 项目 | 说明 |
|------|------|
| 入参 | `htmlFilePath: string` |
| 出参 | `RawBookmark[]` |
| 行为 | 同步读取文件，只处理第一个 `<DL>` 元素（`break` after first） |

### deduplicateByUrl(bookmarks)

URL 内存去重，相同 URL 保留 `add_date` 最新的。详见 [features/dedup.md](dedup.md#内存去重)。

---

## 业务规则

### URL 过滤

跳过以下 scheme 的 URL（大小写不敏感）：

```
javascript:   place:   data:   about:
```

空字符串或纯空格也跳过。

### 标题回退

`title` 为空时，用 `new URL(url).hostname` 作为标题。

[疑似Bug] 如果 URL 格式非法（非标准 URL），`new URL()` 会抛异常导致整个导入失败。但无效 URL 已在前面过滤，实际触发概率低。

### 文件夹路径拼接

递归拼接 `<H3>` 标签的 `textContent`，用 `/` 分隔：

```
"书签栏/技术/Android"
```

根级书签的 `original_folder` 为空字符串 `""`。

### ADD_DATE 解析

- 来源：`<A>` 标签的 `ADD_DATE` 属性
- 格式：Unix 时间戳（秒），`parseInt(value, 10)`
- 无法解析时存为 `null`

### 数据库幂等

`INSERT OR IGNORE`：URL 已存在时静默跳过，不报错，不计入 inserted 数。

---

## 日志输出

```
[INFO] Parsing bookmarks_2026_4_22.html...
[INFO] Parsed 4012 bookmarks
[INFO] Removed 33 duplicate URLs
[INFO] Imported 3959 bookmarks (0 already existed)
```

---

## 验收标准

1. 给定标准 Chrome bookmarks.html，能正确提取所有 `<A>` 标签的 href、标题、ADD_DATE、文件夹路径
2. `javascript:` / `place:` / `data:` / `about:` 链接被过滤
3. 空标题书签的 title 字段为 URL 的 hostname
4. 相同 URL 只保留 add_date 最新的一条
5. 重复导入同一文件不产生重复记录（INSERT OR IGNORE）
6. 文件不存在或格式错误时 exit(1) 并输出错误信息

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 只处理第一个 `<DL>` | `chrome-html.ts:89` 有 `break`，嵌套 DL 通过递归处理，不会遗漏 |
| 无增量导入 | 无法只导入新增书签，全量 `INSERT OR IGNORE` 幂等 |
| 无编码检测 | 假设 UTF-8，GBK 文件可能乱码 [需确认] Chrome 导出是否总是 UTF-8 |
| 同步文件读取 | `fs.readFileSync`，大文件时阻塞主线程 |
