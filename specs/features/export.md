# Feature Spec: export — 导出功能

> ❌ 未实现。本文件基于 `docs/requirements.md` §2.1 / §2.6 的设计定义。

---

## 状态：未开始

---

## 计划的导出格式

| 格式 | 用途 | 优先级 |
|------|------|--------|
| Markdown | 兼容 Obsidian 知识库（frontmatter + 双向链接） | P1 |
| JSON | 数据备份与跨工具迁移 | P1 |

---

## CLI 接口（计划）

```
bm export [options]
```

| 选项 | 类型 | 说明 |
|------|------|------|
| `--format <fmt>` | string | 输出格式：`markdown` / `json` |
| `--output <dir>` | string | 输出目录 |
| `--category <cat>` | string | 按分类导出 |
| `--status <status>` | string | 按状态导出 |

---

## 功能定义（来自需求文档）

### Markdown 导出

兼容 Obsidian 的知识库格式：
- 每条书签一个 `.md` 文件
- frontmatter 包含 tags、category、confidence、value_score
- 正文包含 description / summary / URL

### JSON 导出

完整数据备份：
- 所有字段导出
- 支持通过 `bm import` 重新导入

---

## 验收标准（待实现后验证）

1. Markdown 导出生成有效的 Obsidian 格式文件
2. JSON 导出包含所有字段，可被重新导入
3. `--category` 筛选有效
4. 空数据库时不报错，输出空文件/空数组
