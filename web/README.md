# 记不住 · Web 端（ForgotIt Web）

「记不住（ForgotIt）」的 Web 原型 v1.1——本地优先 AI 记事本。

- 产品与架构设计：[根目录 · 开发文档 v2.0](../forgotIt开发文档.md)
- 部署与运维：[根目录 · 部署文档](../forgotIt部署文档.md)

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 16（App Router）+ React 19 + TypeScript |
| UI | Tailwind CSS 4 + shadcn/ui + Lucide + framer-motion + sonner |
| 数据 | Prisma ORM + SQLite（单文件） |
| 客户端状态 | Zustand（同步引擎）+ localStorage（outbox / 游标 / 设备 ID） |
| AI | z-ai-web-dev-sdk（仅服务端），模拟文档规划的端侧推理 |

## 快速开始

```bash
cp .env.example .env
bun install
bun run db:push
bun run dev        # http://localhost:3000
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | 开发服务器（端口 3000） |
| `bun run lint` | ESLint（基线：0 error 0 warning） |
| `bun run build` | 生产构建（standalone，自动拷贝 static/public） |
| `bun run start` | 启动生产服务（端口默认 3000） |
| `bun run db:push` | schema 变更推送到 SQLite |
| `bun run db:generate` | 重新生成 Prisma Client |
| `bun run db:reset` | 清空并重建数据库 |

## 目录结构

```
src/
├── app/
│   ├── layout.tsx           根布局（zh-CN、主题、viewport、Toaster）
│   ├── page.tsx             单页主入口（视图切换 + 全局状态 + FAB）
│   ├── globals.css          暖纸/暖褐双主题（oklch）、细滚动条
│   └── api/                 17 个路由文件（见下表）
├── components/
│   ├── forgotit/            13 个业务组件
│   │   ├── app-header/footer  顶栏（导航/主题/同步图标）/ 置底页脚
│   │   ├── notes-view        笔记列表（搜索/筛选/网格/空状态）
│   │   ├── note-card         笔记卡（摘要/标签胶囊/待同步角标/操作）
│   │   ├── note-editor       编辑器（源码-预览/附件/仅本地/AI 整理）
│   │   ├── ask-view          RAG 问答（引用卡片/保活）
│   │   ├── tags-view         固定类目 + 自由标签云
│   │   ├── trash-view        回收站（剩余天数/恢复/彻底删除）
│   │   ├── sync-panel        同步面板（设备/离线开关/冲突处置/重建索引）
│   │   ├── empty-state/markdown/theme-*
│   └── ui/                  shadcn/ui 组件
└── lib/
    ├── api.ts               前端 API 客户端（类型 + 统一错误处理 + AbortSignal）
    ├── brand.ts             品牌文案常量（对齐开发文档 §13）
    ├── ai.ts                AI 能力层：打标/摘要/RAG/看图/查询扩展（§16 Prompt 规范）
    ├── embedding.ts         语义索引：分块/向量/余弦/重建
    ├── search.ts            关键词 + 语义双路 → RRF(k=60) 合并
    ├── sync-server.ts       服务端同步：LWW、冲突快照、SyncLog 流水
    ├── sync-store.ts        客户端同步引擎：outbox、游标、30s 轮询、online 事件
    ├── local-first.ts       本地优先写入层（离线降级）
    ├── note-repo.ts         DTO 序列化 / 固定类目 / 类型推断
    └── db.ts                Prisma Client 单例
```

## API 一览

统一约定：错误返回 `{ "error": "..." }` + 对应 4xx/5xx；列表/详情返回 DTO（见 `src/lib/api.ts`）。

### 笔记

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/notes` | 列表。Query：`q` 关键词、`type=all\|text\|image`、`pinned=1`、`tagId`、`view=all\|trash` |
| POST | `/api/notes` | 创建（支持 `localOnly`、附件 dataURL 关联） |
| GET | `/api/notes/:id` | 详情（含标签、附件） |
| PUT | `/api/notes/:id` | 更新（内容/置顶/隐私标记等） |
| DELETE | `/api/notes/:id` | 软删除 → 回收站（30 天） |
| POST | `/api/notes/:id/restore` | 从回收站恢复 |
| POST | `/api/notes/:id/ai-organize` | AI 整理：固定类目 + 3-6 自由标签 + ≤50 字摘要 |

### AI

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/ai/ask` | RAG 问答：检索笔记作答，返回 `{ answer, citations[] }`，正文含 `[n]` 角标 |
| POST | `/api/ai/attachments` | 上传图片 → VLM 生成描述（可先传后建笔记） |
| POST | `/api/ai/reindex` | 全量重建语义索引（增量安全，顺带补齐缺失语义关键词） |

### 搜索（对应开发文档 §8）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/search/keyword` | 关键词检索 `{ query, take? }` |
| POST | `/api/search/semantic` | 语义检索，返回 `hits` + `expansions`（LLM 查询扩展词） |
| POST | `/api/search/hybrid` | 双路检索 → RRF(k=60) 合并，返回各路名次与 RRF 分 |

### 同步（对应开发文档 §6.4 / §6.5）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/sync/push` | 批量推送 `{ deviceId, changes[] }`，服务端 LWW（按 `updatedAt`）裁决 |
| GET | `/api/sync/pull?since=N` | 按 `SyncLog.seq` 游标增量拉取（`local_only` 不下发） |
| GET | `/api/sync/conflicts` | 冲突快照列表 |
| POST | `/api/sync/conflicts` | 处置 `{ id, action: "restore-mine" \| "discard" }` |

### 其他

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tags` | 标签（固定类目 + 自由标签，含计数） |
| GET | `/api/stats` | 统计（笔记/图片/标签/回收站计数） |
| POST | `/api/seed` | 灌入示例数据（含发票图与预生成的 VLM 描述） |
| GET | `/api` | 健康检查 |

## 数据模型（Prisma）

`Note`（含 `localOnly` 隐私标记、`deletedAt` 软删、`version` 同步版本、`semanticKeywords`）
· `Tag`（`kind: category | free`）· `NoteTag`（`source: ai | user`）
· `Attachment`（`description` VLM 描述、`ocrText` 预留）
· `Embedding`（`modelName/modelVersion` 版本化向量分块）
· `SyncLog`（seq 自增同步流水）· `ConflictSnapshot`（LWW 落败方快照）
· `Tombstone`（墓碑占位）

完整字段见 `prisma/schema.prisma`（注释标注了与开发文档 §6.3/§6.5 的对应关系）。

## 关键实现说明

### 语义检索（`lib/embedding.ts` + `lib/search.ts`）

- 原型向量模型 `hash-ngram-zh-v1`：256 维 FNV-1a 加权字符 n-gram 哈希 + L2 归一化，
  中文无需分词器即可近似表达语义；分块 500 字 / overlap 60；
- 每次笔记创建/更新自动异步索引；`POST /api/ai/reindex` 全量重建；
- LLM 生成「语义关键词」（同义词/相关概念）随笔记存储，作为向量化的加权部件，
  查询时 LLM 做查询扩展（`expansions`）；
- 混合检索 = 关键词路（LIKE，生产换 pg_trgm）+ 语义路（余弦 TopK），RRF(k=60) 合并。

### 同步引擎（`lib/sync-server.ts` / `sync-store.ts` / `local-first.ts`）

- 本地优先：所有写操作先落本地（overlay + outbox），失败/离线自动降级暂存；
- outbox 持久化在 localStorage（上限 100 条），联网/启动/30s 轮询触发消费；
- 服务端 LWW：`updatedAt` 新者胜；落败方完整内容写入 `ConflictSnapshot`，
  用户可在同步面板对比后恢复任一版本；
- `localOnly` 笔记在入队前即被过滤，永不出本地。

### 面向生产的替换路径（与开发文档对齐）

| 原型实现 | 生产替换 | 动作 |
| --- | --- | --- |
| `hash-ngram-zh-v1`（256 维） | Gemma Embedding（768 维） | 改 `lib/embedding.ts` 模型常量 + `reindex` |
| SQLite JSON 向量 + JS 余弦 | PostgreSQL + pgvector（HNSW） | 换 datasource + 检索 SQL |
| 关键词 LIKE | pg_trgm GIN 索引 | 换检索 SQL |
| z-ai-web-dev-sdk | flutter_gemma 端侧（Flutter App） | `LlmProvider` 抽象已预留 |
| localStorage outbox | 端侧 drift `sync_queue` 表 | 同步协议不变 |

## 开发约定

- `z-ai-web-dev-sdk` **只能在服务端代码中使用**（API 路由 / `lib/ai.ts`）；
- 客户端组件标注 `'use client'`；服务端数据访问集中在 `src/app/api` 与 `src/lib`；
- 前端统一走 `lib/api.ts` 的请求封装（相对路径 + `{error}` 错误处理 + AbortSignal 防竞态）；
- 交互目标触控面积 ≥ 44px，图标按钮必须 `aria-label`；列表容器 `max-h-* overflow-y-auto` + 细滚动条；
- 提交前 `bun run lint` 保持 0 error 0 warning。
