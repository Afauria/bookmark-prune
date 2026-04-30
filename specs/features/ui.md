# Feature Spec: ui — Web 可视化管理界面

> 书签列表展示、分类/标签过滤、分页浏览、批量扫描。本地 Web 服务，Vite 开发服务器提供 HMR。

## 状态：进行中

---

## CLI 接口

```
bm ui [-p <port>]
```

| 项目 | 说明 |
|------|------|
| 可选参数 | `-p, --port <port>` — 服务端口，默认 3000 |
| 启动行为 | 启动 HTTP 服务，打印访问 URL |
| 退出 | Ctrl+C 优雅关闭数据库连接并退出 |

---

## HTTP API

### GET /api/bookmarks

分页查询书签，支持多维度过滤和排序。

| 查询参数 | 类型 | 说明 |
|----------|------|------|
| `page` | number | 页码（从 1 开始），默认 1 |
| `pageSize` | number | 每页条数（20/50/100/200），默认 50 |
| `category` | string | 按分类过滤（精确匹配） |
| `tag` | string | 按标签过滤（JSON tags 数组包含该值） |
| `status` | string | 按状态过滤（pending / scan_done / deep_done / error / dead / empty），支持逗号分隔多值（如 `dead,empty`） |
| `q` | string | 关键词搜索（标题或 URL 包含） |
| `sort` | string | 排序列（title / category / status / add_date / processed_at / updated_at），默认 updated_at |
| `dir` | string | 排序方向（asc / desc），默认 desc |

**响应**：

```json
{
  "data": [{ "id", "url", "title", "tags", "category", "subcategory", "status", "statusLabel", "add_date", "processed_at", "confidence", "value_score" }],
  "total": 3959,
  "page": 1,
  "pageSize": 50,
  "totalPages": 80
}
```

### POST /api/scan

对指定书签执行快速扫描。

**请求**：`{ "ids": ["uuid1", "uuid2", ...] }`

**响应**：`{ "success": N, "failed": N, "skipped": N, "dead": N, "empty": N }`

跳过 `deep_done` 状态的书签。扫描完成后刷新页面数据。

### POST /api/deep

对指定书签执行深度解析。

**请求**：`{ "ids": ["uuid1", "uuid2", ...] }`

**响应**：`{ "success": N, "failed": N, "skipped": N, "dead": N, "empty": N }`

无正文的书签跳过（不降级）。

### GET /api/stats

统计概览。

### GET /api/categories

所有非空分类列表（用于过滤下拉框），按数量降序。

### GET /api/tags

所有去重标签列表（用于过滤下拉框），按频率降序。

---

## 前端

单页 HTML，嵌入式 CSS + vanilla JS，无框架。

### 过滤组件

可搜索下拉框（Searchable Dropdown）：
- 点击输入框展开下拉列表 + 搜索框
- 输入关键词实时过滤选项
- 选择后自动触发查询
- 分类/标签/状态三个独立下拉框

搜索框：输入防抖 300ms 自动触发查询。

### 表格

| 列 | 说明 |
|----|------|
| ☐ | 复选框，支持单行勾选、全选当前页、全选/取消按钮 |
| 标题 | ID/URL 复制按钮 + 超链接打开 URL |
| 标签 | 可点击徽章，点击触发标签过滤 |
| 分类 | 可点击文字，点击触发分类过滤 |
| 状态 | 彩色徽章（灰/蓝/绿/红） |
| 收藏日期 | YYYY-MM-DD |
| 扫描日期 | YYYY-MM-DD HH:mm |

### 批量操作

工具栏按钮：
- **⚡ 快速扫描** — 对选中书签执行 scan 管道，显示 loading overlay
- **👁 深度解析** — 对选中书签执行 deep 管道，显示 loading overlay
- **全选** — 全选/取消当前页所有书签
- **删除** — 永久删除选中书签（需确认）
- **回收站** — 切换回收站视图（过滤 dead + empty），文本切换为"返回"
- 选中数量实时显示（"N 条已选"）
- 工具栏按钮顺序（右对齐）：全选 → 删除 → 回收站
- 操作完成后自动刷新列表和统计数据，弹出 toast 通知

### 排序

点击表头三态循环：降序(▼) → 升序(▲) → 默认排序。支持按标题、分类、状态、收藏日期、扫描日期排序。

### 分页

- 页大小选择器（20/50/100/200）
- 上一页/下一页导航
- 显示总条数和当前页码

### 其他交互

- Loading overlay：执行扫描/解析时显示全屏遮罩 + spinner
- Toast 通知：操作成功/失败弹出 3 秒自动消失，区分 dead/empty/error 计数

---

## 状态映射

| 数据库 status | 显示文字 | 徽章颜色 |
|---------------|---------|---------|
| `pending` | 未扫描 | 灰色 |
| `scan_done` | 快速扫描 | 蓝色 |
| `deep_done` | 深度扫描 | 绿色 |
| `error` | 失败 | 红色 |
| `dead` | 无法访问 | 橙色 |
| `empty` | 内容为空 | 黄色 |

---

## 回收站页面

过滤 `status IN ('dead', 'empty')` 的书签，提供永久删除功能。

### DELETE /api/bookmarks

**请求**：`{ "ids": ["uuid1", "uuid2", ...] }`
**响应**：`{ "deleted": N }`

物理删除指定书签。

### 回收站 UI

- 顶部工具栏新增"回收站"按钮，点击过滤显示 dead + empty 书签
- 回收站中显示"永久删除"按钮（需确认）
- 支持批量选择 + 批量删除
- 回收站内选中书签后可执行快速扫描/深度解析（重新检测死链、重新抓取内容）

---

## 验收标准

1. `bm ui` 启动后在浏览器中显示书签列表
2. 过滤下拉框支持输入搜索，选择后自动过滤
3. 搜索框输入自动触发查询（防抖）
4. 复选框勾选后快速扫描/深度解析按钮激活
5. 点击快速扫描/深度解析执行对应管道，完成后刷新数据
6. 全选按钮切换当前页选择状态
7. 点击表头排序，箭头指示排序方向
8. 页大小选择器生效
9. 点击标签/分类文字快速过滤
10. `bm ui -p 8080` 在指定端口启动
11. Ctrl+C 优雅关闭
12. 回收站按钮切换 dead+empty 过滤，文本切换为"返回"
13. 删除按钮可永久删除选中书签（带确认弹窗）
14. `npx vite` 启动前端开发服务器，修改 CSS 即时生效不刷新
15. `npm run build` 产物包含 `dist/ui/index.html` + `dist/ui/assets/*`
16. `node dist/index.js ui` 生产模式单端口正常服务
17. 路径 `GET /../package.json` 不泄漏文件系统

---

## 文件结构

```
ui/                     # 前端源码
├── index.html          # HTML 入口
├── style.css           # CSS 样式
└── app.js              # 客户端 vanilla JS
vite.config.js          # Vite 配置（root: ui, proxy, build）
src/ui/server.ts        # API 服务 + 生产静态文件服务
```

## 开发模式

`npm run dev` 一条命令启动前后端：

- 后端：`tsx --watch src/index.ts ui`（端口 3000，代码改动自动重启）
- 前端：`npx vite`（端口 5173，CSS/JS 热更新）
- Vite proxy `/api` → 后端 3000

Vite 配置（`vite.config.js`）：
- `root: 'ui'` — 前端源码目录
- `server.proxy` — `/api` 代理到 `http://localhost:3000`
- `build.outDir` — 输出到 `dist/ui`

前端代码中 `fetch('/api/bookmarks')` 不变，开发时由 Vite 代理转发。后端启动后 Vite 才启动（等 `/api/stats` 可访问）。

## 生产模式

构建：`tsc && vite build`

后端 `server.ts` 从 `dist/ui/` 读取构建产物：
- `/api/*` → API 处理器
- `/assets/*` → 静态文件（带 MIME 校验和路径遍历防护）
- 其他路径 → `index.html`（SPA fallback）

`bm ui` 单端口服务，用户体验不变。

## 安全约束

- 静态文件仅允许 `.html`、`.css`、`.js` 扩展名
- 路径遍历防护：解码 URL 后检查 `..`
- 生产模式静态文件从 `dist/ui/` 目录读取
