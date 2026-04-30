# Feature Spec: check-links — 独立死链检测命令

> 独立检测书签死链、标记 dead 状态、修复重定向。支持 CLI 独立运行，也作为共享函数供 scan 管道调用。

## 状态：进行中

## 数据依赖

- 读写 `bookmarks` 表的 `url`、`status` 字段 → [models/bookmark.md](../models/bookmark.md)
- 依赖 [features/link-check.md](link-check.md)（底层 HTTP 检测）

---

## CLI 接口

```
bm check-links [options]
```

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `-l, --limit <n>` | number | 无限制 | 本次检测的最大书签数 |
| `-s, --start <n>` | number | 0 | 跳过前 N 条（OFFSET） |
| `--force` | boolean | false | 重新检测所有非 dead 的链接 |
| `--url <url>` | string | — | 指定单个 URL 检测（隐含 force=true） |

**查询逻辑**：

| 参数组合 | SQL WHERE 条件 |
|---------|---------------|
| 默认 | `status = 'pending'` |
| `--force` | `status != 'dead'` |
| `--url URL` | `status != 'dead'` + JS 端过滤 `url === URL` |
| `--limit 10` | 追加 `LIMIT 10` |
| `--start 200` | 追加 `OFFSET 200`（无 LIMIT 时自动加 `LIMIT -1`） |

---

## 共享 API

### runLinkCheck(options)

供 `check-links` 命令和 `scan` 管道调用。

| 项目 | 说明 |
|------|------|
| 入参 | `{ db, bookmarks, timeout, concurrency? }` |
| 出参 | `Promise<{ alive: Bookmark[], deadCount: number }>` |
| 副作用 | 更新 DB 中书签的 `status`、`url`（重定向时）字段 |

**处理流程**：

```
输入书签列表
    │
    ▼
调用 checkLinks(urls, timeout, concurrency)
    │
    ▼
遍历结果：
  存活 → 有重定向 → updateBookmark(url=finalUrl)
         加入 alive 列表
  死链 → updateBookmark(status='dead')
         日志 warn
    │
    ▼
返回 { alive, deadCount }
```

**默认参数**：
- `concurrency` 默认 `10`
- `timeout` 由调用方传入（通常 `settings.thresholds.dead_link_timeout`）

---

## 业务规则

1. `dead` 状态的书签始终跳过，不重复检测
2. 死链标记 `status='dead'`，不改变其他字段
3. 存活链接有重定向时更新 DB 中的 URL
4. `--force` 重新检测非 dead 的书签（URL 可能失效）

---

## 管道集成

### Scan 管道

死链检测在 AI 调用之前：
- 对查询到的书签调用 `runLinkCheck()`
- 用返回的 `alive` 列表进行后续 AI 处理
- 死链标记 `status='dead'`，不进入 AI

---

## 日志输出

```
[INFO] Checking 100 links...
[INFO] Redirect: http://example.com → https://example.com
[WARN] Dead link: http://dead.example.com
[INFO] Dead links: 5, alive: 95
Done in 12.3s — ✓95 dead: 5
```

---

## 验收标准

1. `bm check-links` 检测 `status='pending'` 的书签
2. `--force` 时重新检测所有非 `dead` 的书签
3. `--url` 时只检测指定 URL
4. 死链标记 `status='dead'`
5. 存活链接重定向时更新 URL
6. scan 管道仍正常工作（使用共享函数）
7. `bm check-links -l 10` 只检测 10 条
