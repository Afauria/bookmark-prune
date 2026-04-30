# SDD 规范

## 核心原则

Spec 是唯一事实来源。没有 Spec 不写代码，改了代码需要更新 Spec。

## 项目结构

```
project-root/
├── CLAUDE.md              # 项目简介 + 技术栈（10-20行）
├── rules.md               # 本文件（不可修改）
├── specs/
│   ├── overview.md        # 功能地图 + 模块状态
│   ├── architecture.md    # 系统架构 + 技术决策
│   ├── conventions.md     # 命名/风格/API 约定
│   ├── testing.md         # 测试策略 + 覆盖率要求 + 工具链
│   ├── models/{entity}.md # 每个实体一个文件
│   ├── features/{feat}.md # 每个功能一个文件，根据需要决定是否划分目录。
│   └── system/{topic}.md  # auth/db/error/deployment 等（按需创建）
├── docs/                  # 给用户参考文档，不驱动代码开发
│   └── CHANGELOG.md       # 记录重大变更
└── src/
```

## 工作流

```
需求讨论和确认 → 编写Spec → 任务拆分 → 编码 → 测试验收
```

1. **先问再做**：需求模糊时列问题清单等确认，不猜
2. **一次一个**：每次只实现一个功能
3. **Spec 先改**：需求变更 → 先改 Spec → 评估影响范围 → 再改代码
4. **考虑复用**：检查是否有可复用的逻辑/组件/类型/实体，通过引用减少冗余；修改公共部分时列出所有受影响的功能，确认再改
5. **完成即更新**：验收通过后更新 overview.md 状态 + CHANGELOG

## Feature Spec

1. 如有必要，可创建模块目录，再完善Feature Spec
2. 按需编写章节，模版仅供参考

```
# Feature: {功能名}
## 概述（一句话）
## 用户故事 & 验收标准
## 接口定义（API / 组件 Props）
## 业务流程（可以用图表示）
## 业务规则
## 数据依赖（引用 models/xxx.md）
## 状态：未开始 | 进行中 | 已完成
```

## Model Spec

```
## Model: {实体名}
1. 字段定义（名称、类型、约束、默认值）
2. 实体间关系（1:1 / 1:N / M:N）
3. 状态机（如有状态流转）
4. 索引建议
```

## 上下文加载

- 开始任务：读 CLAUDE.md + specs/overview.md + specs/architecture.md
- 实现功能：读对应 feature + 关联 models + 关联 system + specs/testing.md
- 不要一次加载所有 specs

## 禁止

- ❌ 跳过 Spec 写代码
- ❌ 代码改了不更新 Spec
- ❌ 自行假设模糊需求
- ❌ 一次实现多个功能
- ❌ 修改本文件
- ❌ 功能代码无测试即标记完成