# Feature Spec: cache — 内容磁盘缓存

> 链接检测和深度扫描共享的正文磁盘缓存，避免重复 HTTP 请求。

## 状态：已完成

## 数据依赖

- 读 `bookmarks` 表的 url、content 字段 → [models/bookmark.md](../models/bookmark.md)
- 被依赖 → [features/scan.md](scan.md)、[features/link-check.md](link-check.md)

---

## 概述

URL 正文提取后以 `{SHA256(url)}.txt` 格式缓存到磁盘。链接检测时写入，深度扫描时命中，跨进程持久化。

---

## 缓存格式

| 项目 | 说明 |
|------|------|
| 路径 | `{settings.storage.cache}/{bookmarkId}.json` |
| key | bookmark ID |
| 编码 | UTF-8 |

```json
{
  "url": "https://example.com/article",
  "content": "提取后的纯文本正文...",
  "title": "文章标题",
  "cachedAt": "2026-04-30T12:00:00.000Z"
}
```

---

## 写入时机

| 来源 | 触发条件 | 写入内容 |
|------|---------|---------|
| 链接检测 (alive) | HTTP 200 非 soft-404 | `extractContent(html)` → pageData → 磁盘缓存 |
| fetchContent | HTTP 200 无缓存命中 | Readability + selector 提取 → 纯文本 |

两种来源写入格式一致，互相兼容。

---

## 读取时机

| 消费者 | 查找顺序 |
|--------|---------|
| scanner.ts | DB content 字段 → 磁盘缓存 `{id}.json` → 链接检测 HTTP → 提取正文 |

---

## 缓存策略

| 场景 | 是否缓存 | 原因 |
|------|---------|------|
| HTTP 200（alive） | ✓ | 正文有效，后续可复用 |
| HTTP 404/软 404（dead） | ✗ | 页面不存在，无需缓存 |
| HTTP 521/403/超时（error） | ✗ | 瞬时错误，下次可重试 |

---

## 公共函数

### extractContent(html, url)

从原始 HTML 提取正文。使用 Readability + selector 双重提取，取较长结果。

| 项目 | 说明 |
|------|------|
| 入参 | `html: string` — 原始 HTML |
|      | `url: string` — 页面 URL（供 JSDOM 解析） |
| 出参 | `{ content: string, title: string }` |
| 依赖 | `@mozilla/readability` + `jsdom` |

### cacheToDisk(cacheDir, id, data)

将提取后的正文写入磁盘缓存。

| 项目 | 说明 |
|------|------|
| 入参 | `cacheDir: string` — 缓存目录 |
|      | `id: string` — 书签 ID |
|      | `data: { url, title, content }` — 页面数据 |
| 行为 | 自动创建目录，覆盖已存在文件 |

### readCache(cacheDir, id)

按书签 ID 读取磁盘缓存。

| 项目 | 说明 |
|------|------|
| 入参 | `cacheDir: string` — 缓存目录 |
|      | `id: string` — 书签 ID |
| 出参 | `CacheEntry | null` |

---

## 验收标准

1. 快速扫描时 alive 链接的正文被缓存到磁盘
2. 深度扫描时缓存命中，不发 HTTP 请求
3. 重启进程后磁盘缓存仍有效
4. error 状态不缓存，下次扫描可重试
5. 快速扫描 AI prompt 不含正文（不浪费 token）
