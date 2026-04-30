# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

书签整理 CLI（bookmark-prune）：导入 Chrome 书签 → AI 打标签 → 规则引擎分类 → SQLite 存储 → 深度解析覆盖。

**技术栈**：TypeScript strict / Node.js >= 22 / better-sqlite3 / Commander / 原生 fetch（无 AI SDK）/ @mozilla/readability + jsdom

## 构建与运行

```bash
npx tsx src/index.ts <command>   # 开发运行
npx tsc --noEmit                 # 类型检查
npx vitest run                   # 测试（当前零测试文件）
npx vitest run tests/foo.test.ts # 单文件测试
```

## SDD 规范

严格遵循 [rules.md](rules.md) 文档内容。Spec 是唯一事实来源，先改 Spec 再改代码。

上下文加载：开始任务时读 `CLAUDE.md` 和 `rules.md` + `specs/overview.md` + `specs/architecture.md`；实现功能时读对应 feature spec + 关联 models/system。

## 关键约束

- **Pipeline 顺序**：import → scan → deep，`deep_done` 永不被 scan 覆盖
- **AI 不做分类**：AI 只打标签，分类由 `src/pipeline/classifier.ts` 规则引擎决定
- **Deep 不降级**：抓不到正文时跳过，不走 fast 流程
- **SQLite 同步 API**：better-sqlite3 同步方法，`is_alive` 存 INTEGER 0/1
- **CLI 输出中文**，代码注释英文，commit 中文（`feat: / fix: / ...`）
