# Bookmark Prune

书签整理 CLI — 导入 Chrome 书签，AI 打标签，自动分类，死链检测。

## 功能

- **导入**：解析 Chrome 导出的 bookmarks.html，URL 自动去重
- **快速扫描**：标题 + URL → AI 打标签 + 规则引擎分类 + 置信度评分
- **深度解析**：标题 + URL + 全文 → AI 精细标签 + 摘要 + 价值评分
- **死链检测**：三态结果（存活/死链/错误）+ 软 404 识别 + 重定向追溯
- **内容缓存**：磁盘缓存正文，快速扫描缓存供深度扫描复用
- **Web UI**：分类筛选、标签筛选、批量操作、回收站

## 快速开始

```bash
# 安装依赖
npm install

# 1. 复制配置模板
cp config/config.yaml.sample config/config.yaml
cp config/settings.yaml.sample config/settings.yaml

# 2. 编辑配置（填入 AI API Key）
# config/settings.yaml → ai.<provider>.api_key
# config/config.yaml → 自定义标签和分类规则

# 3. 导入 Chrome 书签
npx tsx src/index.ts import -i bookmarks.html

# 4. 快速扫描
npx tsx src/index.ts scan

# 5. 深度解析
npx tsx src/index.ts scan --deep

# 6. 启动 Web UI
npx tsx src/index.ts ui
```

## 开发

```bash
npm run dev       # 前后端热更新（tsx --watch + Vite）
npm run build     # 编译 TypeScript + 构建前端
npx tsc --noEmit  # 类型检查
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `bm import -i <path>` | 导入 Chrome 书签 |
| `bm scan [options]` | 快速扫描（默认） |
| `bm scan --deep` | 深度解析 |
| `bm classify` | 独立规则分类 |
| `bm stats` | 数据库统计 |
| `bm check-links` | 死链检测 |
| `bm ui` | 启动 Web UI |

## 项目结构

```
src/
├── ai/           AI Provider 适配器 + 批处理
├── config/       配置加载 + 提示词模板
├── crawler/      死链检测 + 正文抓取
├── db/           SQLite 数据库 + Repository
├── importer/     Chrome HTML 解析
├── pipeline/     Scan/Deep 管道 + 分类引擎
├── ui/           Web UI 服务端
└── utils/        日志 + 进度报告

config/           配置文件（.gitignore）
prompts/          内置提示词模板
specs/            SDD 规格文档
ui/               前端文件（HTML/CSS/JS）
```

## 技术栈

TypeScript strict / Node.js >= 22 / better-sqlite3 / Commander / 原生 fetch（无 AI SDK）/ @mozilla/readability + jsdom

## License

ISC
