# 测试策略

> 覆盖率要求、测试分层、工具链、Mock 策略。

## 核心规则（来自 rules.md）

1. Feature Spec 的**验收标准**是测试用例的唯一来源，不得凭空编造测试场景
2. 功能代码与测试代码**同步提交**，无测试不算完成
3. 修改公共逻辑时，必须运行所有受影响模块的测试并确认通过
4. **禁止**功能代码无测试即标记完成

---

## 工具链

| 工具 | 版本 | 用途 |
|------|------|------|
| Vitest | ^4.1.5 | 测试框架 |
| better-sqlite3 | ^12.9.0 | 内存数据库 (`:memory:`) |
| vi.fn() / vi.stubGlobal | 内置 | Mock |

**执行命令**：

```bash
npx vitest run                        # 全量
npx vitest run tests/foo.test.ts      # 单文件
npx vitest                            # watch 模式
npx vitest run --coverage             # 覆盖率报告
```

---

## 覆盖率要求

| 指标 | 要求 |
|------|------|
| 纯函数模块（classifier, response-parser, chrome-html） | 行覆盖率 >= 90% |
| 管道模块（scanner, classifier, link-checker） | 行覆盖率 >= 70% |
| 总体 | 行覆盖率 >= 70% |

---

## 测试分层

### T0：纯函数单元测试（无外部依赖）

直接测试，不需要 Mock。

| 模块 | 源码 | 测试来源 | 关键用例 |
|------|------|---------|---------|
| 分类引擎 | `src/pipeline/classifier.ts` | [classify.md 验收标准](features/classify.md) | 空 rules、tags='[]'、URL/title 匹配、tag 匹配、默认值、subcategory |
| AI 响应解析 | `src/ai/response-parser.ts` | [scan.md](features/scan.md) | JSON 提取、markdown 包裹、标签过滤、confidence 默认值、value_score 截断 |
| Chrome HTML 解析 | `src/importer/chrome-html.ts` | [import.md 验收标准](features/import.md) | `<A>` 提取、文件夹路径、无效 URL 过滤、去重逻辑、无 add_date 边界 |
| 配置加载 | `src/config/loader.ts` | [config.md 验收标准](features/config.md) | YAML 解析、`${VAR}` 展开、缺失必填字段、.env 不覆盖已有变量 |

### T1：Mock 依赖的单元测试

| 模块 | Mock 对象 | 测试来源 | 关键用例 |
|------|----------|---------|---------|
| Scanner 管道 | AIProvider, DB, link-checker | [scan.md 验收标准](features/scan.md) | 死链不调 AI、重定向 URL 更新、`deep_done` 跳过、`--force`、fast/deep 模式 |
| deep 模式 | AIProvider, DB, content-fetcher | [scan.md 验收标准](features/scan.md) | 无正文跳过、覆盖 scan 字段、description 保留、`--category` 筛选 |
| Batch 处理 | fetch | scan/deep 管道规则 | 分块 size、并发 semaphore、429 重试、指数退避、chunk 失败不阻塞 |
| Link checker | fetch | [link-check.md 验收标准](features/link-check.md) | 2xx 存活、404/5xx 死链、403+HTML 存活、403 无 HTML 死链、超时死链 |
| 提示词构建 | — | [config.md 验收标准](features/config.md) | `{{tags}}` 替换、`{{input_data}}` 替换、deep 正文截断 3000 字符 |

### T2：集成测试

| 场景 | 测试来源 | 验证点 |
|------|---------|--------|
| import → scan → stats | [import.md](features/import.md) + [scan.md](features/scan.md) + [stats.md](features/stats.md) | 端到端流程，10 条样本 HTML |
| scan → deep → scan | [scan.md](features/scan.md) + [deep.md](features/deep.md) | deep 覆盖 scan，后续 scan 不覆盖 deep_done |
| 中断恢复 | [error-handling.md](system/error-handling.md) | 部分失败后重跑，验证断点续跑 |
| 死链标记 | [link-check.md](features/link-check.md) | 404/403 链接标记正确 |

---

## Mock 策略

| 依赖 | Mock 方式 | 说明 |
|------|----------|------|
| AI 调用 | 实现 `AIProvider` 接口的 Mock 对象 | 返回预设 JSON，控制 tags/confidence/description |
| fetch | `vi.stubGlobal('fetch', vi.fn())` | 模拟 HTTP 响应状态码和内容 |
| 数据库 | better-sqlite3 `:memory:` | 每个测试独立建表，测试结束丢弃 |
| 文件系统 | `os.tmpdir()` + 测试后清理 | 用于提示词加载、正文缓存 |

---

## 测试文件组织

```
tests/
├── unit/
│   ├── classifier.test.ts
│   ├── response-parser.test.ts
│   ├── chrome-html.test.ts
│   └── config-loader.test.ts
├── integration/
│   ├── scan-pipeline.test.ts
│   ├── deep-pipeline.test.ts
│   └── import-to-stats.test.ts
└── fixtures/
    ├── sample-bookmarks.html      # 10-20 条样本书签
    ├── sample-config.yaml         # 测试用 config
    └── sample-settings.yaml       # 测试用 settings
```

---

## 当前状态

| 项目 | 状态 |
|------|------|
| 测试框架 | ✅ Vitest ^4.1.5 已安装 |
| 测试文件 | ❌ 无 |
| Fixtures | ❌ `tests/fixtures/` 为空 |
| 覆盖率配置 | ❌ 未启用 |
| CI 集成 | ❌ 无 |
