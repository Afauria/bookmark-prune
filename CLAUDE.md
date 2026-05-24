# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

书签整理 CLI（bookmark-prune）：导入 Chrome 书签 → AI 打标签 → 规则引擎分类 → SQLite 存储 → 深度解析覆盖。

**技术栈**：TypeScript strict / Node.js >= 22 / better-sqlite3 / Commander / 原生 fetch（无 AI SDK）/ @mozilla/readability + jsdom

## 构建与运行

```bash
npm run dev                      # 启动开发环境（API + Vite HMR）
npx tsx src/index.ts <command>   # 开发运行单个命令
npm run typecheck                # 类型检查（tsc --noEmit）
npm test                         # 运行测试（42 条）
npx vitest run tests/foo.test.ts # 单文件测试
npm run build                    # 构建（tsc + vite build）
```

## SDD 规范

严格遵循 [rules.md](rules.md) 文档内容。Spec 是唯一事实来源，先改 Spec 再改代码。

上下文加载：开始任务时读 `CLAUDE.md` 和 `rules.md` + `specs/overview.md` + `specs/architecture.md`；实现功能时读对应 feature spec + 关联 models/system。

## 架构要点

```
CLI (index.ts) → pipeline/ (编排层) → ai/ + crawler/ + db/ + config/
```

- **pipeline/** 是唯一编排层，可依赖所有模块
- **ai/** 不知道 pipeline 的存在；**crawler/** 不知道 ai 的存在
- **classifier.ts** 是纯函数，无副作用，不依赖 DB 或 AI
- **db/repository.ts** 是唯一数据访问层，所有 CRUD 操作集中于此

状态机 4 态：`pending → tagged / dead / error`，用 `scan_mode` 字段区分 fast/deep 处理深度。

## 关键约束

- **Pipeline 顺序**：import → scan → deep，deep 可覆盖 fast 结果
- **AI 不做分类**：AI 只打标签，分类由 `src/pipeline/classifier.ts` 规则引擎决定
- **Deep 不降级**：抓不到正文时跳过，不走 fast 流程；deep 逐篇提交
- **CLI 输出中文**，代码注释英文，commit 中文（`feat: / fix: / ...`）
