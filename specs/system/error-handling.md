# 错误处理策略

> 错误处理策略：AI 重试、爬虫容错、管道跳过、CLI 退出。

---

## 错误分层

### 层 1：AI 调用层（ai/）

| 错误 | 处理方式 | 代码位置 |
|------|---------|---------|
| 429 Rate Limit | 抛 `RetryableError`，batch.ts 按 `retryAfterMs` 等待后重试 | `anthropic.ts:28`, `openai.ts:28`, `ollama.ts:23` |
| 5xx 服务端错误 | batch.ts 指数退避重试（`1000 * 2^attempt` ms） | `batch.ts:107` |
| AI 返回非 JSON | 整个 chunk 标记 failed，不阻塞其他 chunk | `batch.ts:91` |
| 标签不在允许列表 | response-parser 过滤掉，不报错 | `response-parser.ts` |

**重试机制**（`batch.ts`）：
- 最大重试次数：`settings.ai.batch.retry`（默认 3）
- RetryableError（429）：按服务端 `Retry-After` 等待
- 其他错误：指数退避 `1000 * 2^attempt` ms
- 重试耗尽：整个 chunk 的书签计入 `batchResult.failed`

### 层 2：爬虫层（crawler/）

| 错误 | 处理方式 | 代码位置 |
|------|---------|---------|
| 链接检测失败（网络错误/超时） | 返回 `{ alive: false }` | `link-checker.ts:41` |
| 正文抓取失败 | 返回 `{ success: false, content: null }` | `content-fetcher.ts:70` |
| 正文提取失败（Readability） | 返回 `{ success: true, content: null }` [需确认] | `content-fetcher.ts` |

### 层 3：管道层（pipeline/）

| 错误 | 处理方式 | 代码位置 |
|------|---------|---------|
| AI chunk 失败 | 该 chunk 书签不更新，计入 failed | `scanner.ts` |
| 正文抓取失败（deep） | 跳过该书签，不调 AI，计入 skipped | `scanner.ts` |
| 死链 | 标记 `status='dead'`，不调 AI | `link-checker.ts` |
| 分类无匹配 | 返回"待分类"，不报错 | `classifier.ts:80` |

### 层 4：CLI 层（index.ts）

| 错误 | 处理方式 |
|------|---------|
| 任何未捕获异常 | `try/catch` + `logger.error` + `process.exit(1)` |
| 缺少必填参数 | commander 自动报错 |

---

## 错误恢复

- **断点续跑**：基于 `status` 字段，跳过已处理的书签
- **`--force` 重新处理**：覆盖 `scan_done` 和 `error` 状态
- **`deep_done` 不可覆盖**：除非 `--force` 用于 deep 命令
- **Ctrl+C 中断**：已处理的书签已持久化到 SQLite

---

## 不存在的错误处理 [需补建]

| 项目 | 说明 |
|------|------|
| 优雅退出 (SIGINT) | 当前 Ctrl+C 直接终止，无 cleanup |
| 错误码体系 | 所有错误都 exit(1)，无细分 |
| 错误通知 | 无重试耗尽后的汇总报告 |
