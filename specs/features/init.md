# Feature Spec: init — 配置生成

> ❌ 未实现。本文件基于 `docs/requirements.md` §七 的设计定义。

---

## 状态：未开始

---

## CLI 接口（计划）

```
bm init [options]
```

| 选项 | 类型 | 说明 |
|------|------|------|
| `--input <path>` | string | 书签 HTML 文件路径 |
| `--regenerate` | boolean | 重新生成（覆盖已有配置） |

---

## 功能定义（来自需求文档）

### 输入

书签 HTML 文件或 DB 中已导入的书签样本。

### 处理流程

```
1. 解析书签，采样 200 条
2. 统计：域名分布 + 关键词频率 + 原始文件夹结构
3. 调用 AI 生成推荐配置
4. 输出到 config/config.yaml（带注释）
5. 用户可手动调整或 --regenerate 重新生成
```

### 生成内容

| 字段 | 生成逻辑 |
|------|---------|
| `profile` | 基于域名分布和内容主题，生成用户画像 |
| `tags` | 基于标题/URL 关键词频率 + AI 归纳 |
| `classification_rules` | 基于标签分布 + AI 推断 |

### 提示词模板

```
你是一个书签管理助手。用户导入了一批书签，请根据以下数据为其生成推荐配置。

## 用户书签统计
- 总数：{{total_count}}
- 域名分布：{{domain_distribution}}
- 高频关键词：{{keyword_frequency}}
- 原始文件夹：{{original_folders}}

## 要求
1. 生成领域标签（10-20个），覆盖用户的主要兴趣方向
2. 生成技术关键词标签（15-30个），基于高频技术词汇
3. 生成分组映射规则，优先级从高到下
4. 生成用户画像描述（一句话）

## 输出格式
返回完整的 config.yaml 内容
```

---

## 依赖

| 依赖 | 状态 |
|------|------|
| 书签解析 | ✅ `chrome-html.ts` 已实现 |
| AI 调用 | ✅ `provider.ts` + `batch.ts` 已实现 |
| 配置写入 | ❌ 需实现 YAML 写入 + 注释 |
| 统计采样 | ❌ 需实现域名分布、关键词频率统计 |
| 提示词模板 | ❌ 需创建 `prompts/init.md` |

---

## 验收标准（待实现后验证）

1. `bm init --input bookmarks.html` 生成有效的 `config/config.yaml`
2. 生成的 tags 包含 domain + tech + type + meta + status 五类
3. 生成的 classification_rules 覆盖主要分类，有 default 兜底
4. 生成的 profile 是一句话描述
5. 已有 config 时不覆盖（除非 `--regenerate`）
6. 生成的 YAML 带注释说明每个字段的用途
