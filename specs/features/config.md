# Feature: config — 配置加载与提示词构建

> 加载 YAML 配置 + .env 环境变量 + 提示词模板渲染。

## 概述

系统启动时加载两份 YAML 配置（`config.yaml` 用户配置、`settings.yaml` 软件设置），解析 `.env` 文件，展开 `${VAR}` 环境变量引用，并加载提示词模板（用户覆盖优先于内置默认）。

### 文件职责

| 文件 | 职责 | 提交 Git |
|------|------|---------|
| `config/config.yaml` | 个人配置：标签、分类规则、用户画像 | 否（含个人信息） |
| `config/settings.yaml` | 软件设置：AI Provider、存储路径、阈值 | 否（含 API Key） |
| `config/*.yaml.sample` | 配置示例模板 | 是 |
| `.env` | 敏感信息：API Key | 否 |
| `config/prompts/*.md` | 用户自定义提示词（可选覆盖） | 否 |
| `prompts/*.md` | 内置默认提示词 | 是 |
| `priv/` | 个人文件：提示词、标签习惯、分析文档 | 否 |

## 状态：已完成

---

## 配置文件

### config/config.yaml — 用户配置

用户可修改的个人配置。首次使用时复制示例模板：`cp config/config.yaml.sample config/config.yaml`

| 顶级字段 | 类型 | 说明 |
|----------|------|------|
| `profile` | string | 个人上下文描述（用于 `bm init` 生成推荐配置） |
| `tags.domain` | string[] | 领域标签（每条书签 1 个，对应一级分类） |
| `tags.tech` | string[] | 技术关键词标签（每条书签 1-3 个） |
| `tags.type` | string[] | 内容类型标签（可选 0-1 个） |
| `tags.meta` | string[] | 场景来源标签（可选 0-2 个） |
| `tags.status` | string[] | 状态标签（可选 0-2 个） |
| `classification_rules` | ClassificationRule[] | 分类映射规则，按优先级从上到下 |

规则结构详见 [features/classify.md](classify.md#规则结构)。

**校验**：`tags` 和 `classification_rules` 缺失时抛异常。

### config/settings.yaml — 软件设置

| 字段 | 类型 | 说明 |
|------|------|------|
| `ai.provider` | string | 当前使用的 Provider：`anthropic` / `openai` / `ollama` |
| `ai.<provider>.api_key` | string | API 密钥（支持 `${ENV_VAR}` 引用） |
| `ai.<provider>.base_url` | string? | API 端点覆盖 |
| `ai.<provider>.model` | string | 模型名称 |
| `ai.batch.size` | number | 每次批处理的书签数（默认 20） |
| `ai.batch.concurrency` | number | 并发数（默认 3） |
| `ai.batch.retry` | number | 最大重试次数（默认 3） |
| `ai.batch.delay_seconds` | number | 重试间隔基础值（默认 1） |
| `storage.db` | string | SQLite 数据库路径（默认 `./data/bookmarks.db`） |
| `storage.cache` | string | 缓存目录路径（默认 `./data/cache/`） |
| `thresholds.low_confidence` | number | 低置信度阈值（默认 0.7） |
| `thresholds.dead_link_timeout` | number | 死链检测超时秒数（默认 10） |

**校验**：`ai.provider` 缺失时抛异常。

### .env — 环境变量

标准 KEY=VALUE 格式，`#` 开头为注释。已设置的 `process.env` 变量不会被覆盖。

---

## API 端点

### loadConfig(configPath?)

| 项目 | 说明 |
|------|------|
| 源码 | `src/config/loader.ts:52` |
| 入参 | `configPath?: string`（默认 `config/config.yaml`） |
| 出参 | `AppConfig` |
| 副作用 | 无 |
| 异常 | 文件不存在 / YAML 解析失败 / 缺少必填字段 |

### loadSettings(settingsPath?)

| 项目 | 说明 |
|------|------|
| 源码 | `src/config/loader.ts:70` |
| 入参 | `settingsPath?: string`（默认 `config/settings.yaml`） |
| 出参 | `Settings` |
| 副作用 | 无 |
| 异常 | 文件不存在 / YAML 解析失败 / 缺少 `ai.provider` |

### loadPrompt(mode, customDir?)

| 项目 | 说明 |
|------|------|
| 源码 | `src/config/prompts.ts:5` |
| 入参 | `mode: 'scan' \| 'deep'`, `customDir?: string`（默认 `config/prompts`） |
| 出参 | `string`（提示词模板内容） |
| 加载优先级 | `config/prompts/<mode>.md` > `prompts/<mode>.md`（内置） |
| 异常 | 两处都不存在时抛异常 |

### buildScanPrompt(template, config, bookmarks)

| 项目 | 说明 |
|------|------|
| 源码 | `src/config/prompts.ts:56` |
| 入参 | 模板字符串 + `AppConfig` + 书签列表 |
| 出参 | `string`（渲染后的提示词） |
| 模板变量 | `{{tags}}` → 标签列表，`{{input_data}}` → 格式化书签数据 |

### buildDeepPrompt(template, config, bookmarks)

| 项目 | 说明 |
|------|------|
| 源码 | `src/config/prompts.ts:66` |
| 入参 | 模板字符串 + `AppConfig` + `{ url, title, content }[]` |
| 出参 | `string`（渲染后的提示词） |
| 正文截断 | `content.slice(0, 3000)` — 按字符数截断 |

### getAllowedTags(config)

| 项目 | 说明 |
|------|------|
| 源码 | `src/config/loader.ts:88` |
| 入参 | `AppConfig` |
| 出参 | `string[]`（所有标签类别合并） |
| 合并顺序 | domain + tech + type + meta + status |

---

## 业务规则

### .env 加载

- 模块导入时自动执行（`loadDotEnv()` 在顶层调用）
- 已存在的 `process.env` 变量不会被覆盖（`if (!process.env[key])`）
- 路径固定为 `process.cwd()/.env`

### 环境变量展开

- `${VAR}` 语法在 YAML 值中展开为 `process.env[VAR]`
- 未定义的环境变量展开为空字符串 `''`
- 递归展开：对象、数组、字符串值均会被处理
- 展开发生在 YAML 解析之后

### 路径解析

- 相对路径基于 `process.cwd()` 解析
- 绝对路径直接使用

### 标签新增同步

新增标签时必须同步修改：
1. `config.yaml` 的对应 tags 列表
2. `classification_rules` 中对应的分类规则
3. `{{tags}}` 自动注入，提示词无需手动修改

### 提示词自定义

用户在 `config/prompts/` 目录放置同名文件即可覆盖内置模板：

```bash
cp prompts/scan.md config/prompts/scan.md
# 编辑 config/prompts/scan.md
```

必须保留 `{{tags}}` 和 `{{input_data}}` 占位符。

### 提示词模板

**内置模板**（`prompts/` 目录）：

| 文件 | 模板变量 | AI 输出字段 |
|------|---------|------------|
| `scan.md` | `{{tags}}`, `{{input_data}}` | tags, confidence, description, value_score |
| `deep.md` | `{{tags}}`, `{{input_data}}` | tags, confidence, summary, value_score |

**书签数据格式化**：

fast 模式：
```
1. URL: https://example.com
   标题: Example Title
```

Deep 模式（含正文截断 3000 字符）：
```
1. URL: https://example.com
   标题: Example Title
   正文: (前3000字符...)
```

无正文时显示 `正文: (无正文，仅根据标题和URL判断)`。

---

## 验收标准

1. `config.yaml` 缺少 `tags` 或 `classification_rules` 时抛异常
2. `settings.yaml` 缺少 `ai.provider` 时抛异常
3. `.env` 中已设置的 `process.env` 变量不被覆盖
4. `${VAR}` 在 YAML 值中被正确展开，未定义变量展开为空
5. 用户提示词（`config/prompts/`）优先于内置提示词（`prompts/`）
6. 提示词 `{{tags}}` 被替换为分类标签列表
7. 提示词 `{{input_data}}` 被替换为格式化的书签数据
8. Deep 模式正文截断为 3000 字符
9. 路径参数支持绝对路径和相对路径

---

## 缺失项

| 项目 | 说明 |
|------|------|
| config schema 校验 | 仅校验 `tags`/`classification_rules`/`ai.provider` 存在，不校验字段类型和内容 |
| settings.yaml 默认值 | `batch`/`thresholds`/`storage` 无默认值回退，缺失时为 undefined |
| profile 字段 | 已定义但未被任何代码使用（预留给 `bm init`） |
| 提示词模板校验 | 不检查模板是否包含必需的 `{{tags}}` 和 `{{input_data}}` 占位符 |
