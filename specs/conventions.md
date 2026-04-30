# 编码规范与技术约定

> 从现有代码实际风格中提取。

---

## TypeScript

- **严格模式**：`tsconfig.json` 开启 `strict: true`，零 `any`
- **模块系统**：ESM（`"type": "module"`），`module: NodeNext`，导入路径必须带 `.js` 后缀
- **Target**：ES2024
- **类型导入**：使用 `import type` 语法（如 `import type { Bookmark } from '../types.js'`）
- **类型集中定义**：所有接口在 `src/types.ts`，不散落在各模块

### 命名规范

| 项目 | 风格 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `link-checker.ts`, `content-fetcher.ts` |
| 目录名 | kebab-case | `content-fetcher/`, `system/` |
| 变量/函数 | camelCase | `getBookmarksForScan`, `linkResults` |
| 类 | PascalCase | `ProgressReporter`, `RetryableError` |
| 接口 | PascalCase | `AIProvider`, `Bookmark` |
| 类型别名 | PascalCase | `BookmarkStatus` |
| 常量 | camelCase | `techTags`, `allowedTags` |
| SQL 字段 | snake_case | `add_date`, `processed_at`, `value_score` |

### 导出风格

- **函数**：命名导出（`export function` / `export async function`），无默认导出
- **接口/类型**：命名导出（`export interface` / `export type`）
- **类**：命名导出（`export class`）

### 数据库字段映射

TypeScript 接口用 camelCase，SQLite 用 snake_case，`repository.ts` 负责转换：

| TypeScript 字段 | SQLite 列 |
|-----------------|-----------|
| `addDate` | `add_date` |
| `isDuplicate` | `is_duplicate` |
| `valueScore` | `value_score` |
| `aiModel` | `ai_model` |
| `processedAt` | `processed_at` |
| `createdAt` | `created_at` |
| `updatedAt` | `updated_at` |

---

## 语言约定

| 上下文 | 语言 | 示例 |
|--------|------|------|
| CLI 输出 / help 文本 | 中文 | `bm scan --help` 显示中文描述 |
| 日志信息 | 中文 | `[INFO] 正在扫描...` |
| 代码注释 | 英文 | `// Dead link detection` |
| 变量名 / 函数名 | 英文 | `getBookmarksForScan` |
| commit message | 中文 | `feat: 添加死链检测` |
| 提示词（AI Prompt） | 中文 | `你是一个书签分类助手` |
| Spec 文档 | 中文 | 本文件 |

---

## 依赖约定

- **AI 调用**：不使用 SDK，全部通过原生 `fetch()`
- **数据库**：只使用 `better-sqlite3` 同步 API，不用异步驱动
- **HTML 解析**：`node-html-parser` 用于 Chrome 书签，`jsdom` + `Readability` 用于正文提取
- **新增依赖**：需要评估是否有轻量替代方案

---

## 错误处理

- **AI 调用失败**：重试机制在 `batch.ts`（指数退避 + Retry-After），最终失败整个 chunk 标记 failed
- **DB 错误**：CLI 层 `try/catch` + `process.exit(1)`
- **抓取失败**：返回 `success: false`，调用方决定是否跳过
- **不抛出业务异常**：分类引擎返回"待分类"而非抛错

---

## Git 规范

### Commit 格式

```
<type>: <中文描述>
```

type 取值：

| type | 用途 |
|------|------|
| feat | 新功能 |
| fix | 修复 bug |
| refactor | 重构（不改行为） |
| docs | 文档变更 |
| chore | 构建/工具变更 |

### 不提交的文件

```
data/            # SQLite DB + 缓存
.env             # 密钥
node_modules/    # 依赖
dist/            # 编译产物
```

---

## 缺失项 [需补建]

| 项目 | 状态 | 说明 |
|------|------|------|
| ESLint | ❌ 未配置 | [需确认] 是否添加 eslint + 规则集 |
| Prettier | ❌ 未配置 | [需确认] 是否添加 prettier + 配置 |
| CI/CD | ❌ 未配置 | 无 GitHub Actions 或其他 CI |
| EditorConfig | ❌ 未配置 | 无 `.editorconfig` |
