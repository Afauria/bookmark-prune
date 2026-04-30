# Changelog

## 0.1.0 (2025-04-30)

首版发布，bookmark-prune 书签整理 CLI。

### 功能

- **import**：导入 Chrome 书签 HTML，解析文件夹路径，URL 去重
- **fast**：AI 快速打标签 + 规则引擎自动分类 + 置信度评分
- **deep**：AI 深度解析（抓取正文 → 生成摘要 → 精细标签 → 价值评分）
- **classify**：独立运行分类引擎（Pre-AI / AI 标签 / Post-AI / 兜底 4 阶段）
- **check-links**：死链检测（三态结果 + 软404 识别 + 域名分组串行）
- **stats**：数据库统计（分类/标签/状态分布）
- **ui**：Web UI（Vite HMR + API 代理 + 书签管理界面）

### 技术栈

- TypeScript strict / Node.js >= 22 / better-sqlite3 / Commander
- AI 多后端：OpenAI / Anthropic / Ollama / Gemini（原生 fetch，无 SDK）
- 正文提取：@mozilla/readability + jsdom
- 配置：YAML + .env + 环境变量展开
