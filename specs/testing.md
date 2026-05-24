# 测试策略

> 覆盖率要求、场景划分、工具链、Mock 策略。

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
| vi.fn() / vi.spyOn | 内置 | Mock |

**执行命令**：

```bash
npx vitest run                        # 全量
npx vitest run tests/scenarios/foo.test.ts  # 单文件
npx vitest                            # watch 模式
npx vitest run --reporter=verbose     # 详细输出
npx vitest run --coverage             # 覆盖率报告
```

---

## 覆盖率要求

| 指标 | 要求 |
|------|------|
| 核心算法模块（classifier, response-parser） | 行覆盖率 >= 90% |
| 管道 + 数据层（scanner, repository, content-fetcher） | 行覆盖率 >= 70% |
| 总体 | 行覆盖率 >= 70% |

---

## 场景划分

按业务场景组织测试，不按函数逐个覆盖。每个测试对应一条验收标准或一个端到端流程。

### 核心算法场景（无 Mock）

| 场景 | 测试文件 | 验收标准来源 | 关键验证 |
|------|---------|-------------|---------|
| 分类引擎 | `tests/scenarios/classify.test.ts` | [classify.md](features/classify.md) | 空 rules → 待分类、4 阶段匹配流程、subcategory 生成规则、OR 逻辑 |
| AI 响应解析 | `tests/scenarios/ai-response.test.ts` | [scan.md](features/scan.md) | 批量 JSON 解析、代码块提取、标签过滤、数据校验（截断/默认值）、异常输入 |

### 端到端流程场景

| 场景 | 测试文件 | 验收标准来源 | 关键验证 |
|------|---------|-------------|---------|
| 导入流程 | `tests/scenarios/import.test.ts` | [import.md](features/import.md) | HTML 解析、URL 过滤、标题回退、去重、文件不存在报错 |
| 正文提取与缓存 | `tests/scenarios/content-extraction.test.ts` | [cache.md](features/cache.md) | HTML → 正文提取、缓存读写、空内容不缓存、key 一致性 |

### 数据层场景（`:memory:` SQLite）

| 场景 | 测试文件 | 验收标准来源 | 关键验证 |
|------|---------|-------------|---------|
| 状态流转与查询 | `tests/scenarios/data-layer.test.ts` | scan/classify/check-links 验收标准 | 幂等插入、scan/deep/link-check/classify 查询语义、COALESCE 保留 description、去重标记、过滤查询 |

### 待补充场景

| 场景 | 依赖 | 验收标准来源 |
|------|------|-------------|
| 死链检测 | Mock fetch | [link-check.md](features/link-check.md) 验收标准 |
| 中断恢复 | Mock AI/HTTP | [error-handling.md](system/error-handling.md) |

---

## Mock 策略

| 依赖 | Mock 方式 | 说明 |
|------|----------|------|
| AI 调用 | 实现 `AIProvider` 接口的 Mock 对象 | 返回预设 JSON，控制 tags/confidence/description |
| fetch | `vi.stubGlobal('fetch', vi.fn())` | 模拟 HTTP 响应状态码和内容 |
| 数据库 | better-sqlite3 `:memory:` | 每个测试独立建表，测试结束丢弃 |
| 文件系统 | `os.tmpdir()` + 测试后清理 | 用于正文缓存测试 |

---

## 测试文件组织

```
tests/
├── scenarios/                        # 按业务场景组织
│   ├── classify.test.ts              # 分类引擎核心算法
│   ├── ai-response.test.ts           # AI 响应解析流程
│   ├── import.test.ts                # 导入流程（解析 + 去重）
│   ├── content-extraction.test.ts    # 正文提取 + 缓存流程
│   ├── data-layer.test.ts            # 数据层状态流转与查询语义
│   └── e2e/
│       └── scan-flow.test.ts         # Scan 管道端到端测试
└── fixtures/                         # 测试夹具
    ├── sample-bookmarks.html         # 10 条样本书签
    ├── sample-config.yaml            # 测试用 config
    └── sample-settings.yaml          # 测试用 settings
```

---

## 当前状态

| 项目 | 状态 |
|------|------|
| 测试框架 | ✅ Vitest ^4.1.5 已安装 |
| 测试配置 | ✅ `vitest.config.ts` 已配置覆盖率和 glob |
| 场景测试 | ✅ 6 个场景文件，42 条测试 |
| Fixtures | ✅ `tests/fixtures/` 已创建 |
| 端到端测试 | ✅ Scan 管道集成测试 |
| CI 集成 | ❌ 无 |
