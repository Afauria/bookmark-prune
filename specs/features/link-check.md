# Feature Spec: link-check — 死链检测 + 重定向修复

> 死链检测、软 404 识别、重定向修复、按域名分组串行检测、返回页面 HTML。

## 状态：已完成

## 数据依赖

- 读写 `bookmarks` 表的 url、status 字段 → [models/bookmark.md](../models/bookmark.md)

---

## API 端点

### checkLink(url, timeout)

| 项目 | 说明 |
|------|------|
| 入参 | `url: string` — 待检测的 URL |
|      | `timeout: number` — 超时秒数（乘 1000 转毫秒） |
| 出参 | `Promise<LinkCheckResult>` — 三态结果 |

### checkLinks(urls, timeout, concurrency)

| 项目 | 说明 |
|------|------|
| 入参 | `urls: string[]` — 批量 URL |
|      | `timeout: number` — 单个链接超时秒数 |
|      | `concurrency: number` — 未使用（保留接口兼容） |
| 出参 | `Promise<Map<string, LinkCheckResult>>` — URL → 检测结果映射 |
| 并发模型 | 按域名分组，同域名串行（300ms 间隔），不同域名并行 |

---

## LinkCheckResult

```typescript
type LinkStatus = 'alive' | 'dead' | 'error';

interface LinkCheckResult {
  status: LinkStatus;
  httpStatus?: number;
  finalUrl?: string;
  content?: string;   // full HTML, only for alive (200)
}
```

| status | 含义 | 后续处理 |
|--------|------|---------|
| `alive` | HTTP 200 且非软 404 | → AI 处理 |
| `dead` | HTTP 404/410 或软 404 | → 标记 `status='dead'` |
| `error` | 403/5xx/超时/网络错误 | → 标记 `status='error'`，可重试 |

---

## 单链接检测流程

```
HTTP GET (redirect: follow, timeout, browser UA)
    │
    ├─ 网络错误/超时/abort → { status: 'error' }
    │
    ├─ 2xx → 读取完整 HTML
    │     ├─ 软 404（title 含 "404"/"页面不存在"等） → { status: 'dead', content }
    │     └─ 正常页面 → { status: 'alive', content: html }
    │
    ├─ 404/410 → { status: 'dead' }
    │
    └─ 403/5xx → { status: 'error' }（不尝试判断内容，避免误判）
```

### 请求细节

| 项目 | 值 |
|------|---|
| HTTP 方法 | `GET`（非 HEAD） |
| User-Agent | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36` |
| 重定向 | `redirect: 'follow'`（自动跟随） |
| 超时 | `AbortController` + `setTimeout(timeout * 1000)` |

---

## 软 404 检测

HTTP 200 但实际页面不存在的检测规则：

```typescript
const SOFT_404_PATTERNS = [
  /<title[^>]*>.*404.*<\/title>/i,
  /<title[^>]*>.*not found.*<\/title>/i,
  /<title[^>]*>.*页面不存在.*<\/title>/i,
  /<title[^>]*>.*找不到.*<\/title>/i,
  /<title[^>]*>.*页面找不到了.*<\/title>/i,
  /<title[^>]*>.*内容不存在.*<\/title>/i,
];
```

匹配 `<title>` 内容即判定为 dead。

---

## 重定向检测

```typescript
const finalUrl = response.url !== url ? response.url : undefined;
```

在 scanner.ts 中检测到重定向时：
1. 更新 DB 中的 `url` 字段为 `finalUrl`
2. 首次重定向时保存原 URL 到 `original_url` 字段
3. 更新内存中 bookmark 对象的 `url` 字段

---

## 批量检测

按域名分组，同域名串行（300ms 间隔），不同域名并行：

```
URLs = [csdn-1, github-1, csdn-2, toutiao-1, csdn-3]

分组:
  csdn.net    → [csdn-1, csdn-2, csdn-3]  (串行, 300ms 间隔)
  github.com  → [github-1]                  (独立)
  toutiao.com → [toutiao-1]                 (独立)

三组并行执行
```

- 同域名请求间隔 300ms，避免触发 Cloudflare/CSDN 等限流
- 不同域名并行，不浪费时间
- 200 响应返回完整 HTML（`content` 字段），供后续缓存复用

---

## 管道集成

**共享函数**：`runLinkCheck()` → [features/check-links.md](check-links.md)
- scan 和 check-links 统一调用，逻辑在 `src/pipeline/link-checker.ts`

**Scan 管道**：分批交替处理（每批 10 条）
- alive → AI 处理
- dead → 标记 `status='dead'`
- error → 标记 `status='error'`（可重试）

**独立命令**：`bm check-links` → [features/check-links.md](check-links.md)

---

## 验收标准

1. 200 响应 → alive，返回 content
2. 200 但 title 含 "404" → dead（软 404）
3. 404/410 响应 → dead
4. 403/5xx 响应 → error（不尝试判断内容）
5. 网络错误/超时 → error，不抛异常
6. 重定向后 URL 不同 → finalUrl 有值
7. 同域名请求间隔 ≥ 300ms
8. 不同域名请求并行执行
9. error 结果不缓存，下次可重试
