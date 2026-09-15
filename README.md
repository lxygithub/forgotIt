<div align="center">

<img src="web/public/images/empty-brain.jpg" alt="记不住 · 空脑插画" width="360" />

# 记不住 · ForgotIt

**脑子寄存处。**

随手一记，AI 帮你归类、打标、写摘要；
哪天想不起来了，用大白话问一句，它替你把记忆找回来。

[开发文档](./forgotIt开发文档.md) · [原生移动端开发文档](./forgotIt原生移动端开发文档.md) · [部署文档](./forgotIt部署文档.md) · [Web 端开发指南](./web/README.md)

</div>

---

## 这是什么

「记不住」是一个**本地优先**的 AI 记事本。它默认你是个记性不好的人——所以：

- **记的时候零负担**：不用想分类、不用想标题，随手一存，AI 自动帮你归入固定类目、打自由标签、写一句 ≤50 字的摘要；
- **找的时候零门槛**：不用回忆当时用了什么词，用大白话问——「找一下能报销的票」「最近身体有什么要注意的」——混合检索会把语义相关的都捞出来；
- **数据零焦虑**：单机可用、离线可用，隐私笔记（仅本地）永不上传，回收站 30 天反悔期。

## 功能特性（Web 原型 v1.2）

| 能力 | 说明 |
| --- | --- |
| 📝 快速记 | 纯文本 / Markdown 源码-预览双模式，支持置顶 |
| 🏷️ AI 自动整理 | 9 个固定类目 + AI 自由标签（3-6 个）+ 一句话摘要，打标失败自动兜底 |
| 💬 大白话问答 | RAG 检索你的笔记作答，带 `[n]` 引用角标，引用可点击回原笔记 |
| 🖼️ 图片理解 | 上传图片，VLM 自动生成描述（发票、报告、截图都能被搜到） |
| 🔍 三路搜索 | 关键词 / 语义向量 / 混合检索（双路 RRF k=60 合并），语义检索带查询扩展 |
| 🔄 多设备同步 | 本地优先 + outbox 离线暂存，联网自动推送；LWW 冲突合并 + 冲突快照可回滚 |
| 🔐 单用户鉴权 | NextAuth 密码门禁：未登录一切页面 / API / 上传图片均拒绝，支持 scrypt 哈希口令 |
| 🔒 仅本地隐私 | `local_only` 笔记不入同步队列、永不出本地 |
| 🗑️ 回收站 | 软删除保留 30 天，显示剩余天数，可恢复 |
| 🌗 深色模式 | 暖纸底 / 暖褐底双主题，琥珀主色 |
| 📱 响应式 | 桌面三列到移动端单列，触控目标 ≥ 44px |

## 架构一览

```
┌────────────────────────────────────────────────────┐
│                  客户端（浏览器）                     │
│   本地优先写入层：overlay + outbox(localStorage)      │
│   离线可记 → 联网自动推送 → 30s 轮询增量拉取            │
└──────────────┬──────────────────▲──────────────────┘
               │ push(upsert/删除) │ pull?since=seq
┌──────────────▼──────────────────┴──────────────────┐
│           Web 服务（Next.js 16 App Router + NextAuth）           │
│                                                    │
│  笔记 CRUD · 混合标签 · 回收站 · 同步流水(SyncLog)     │
│                                                    │
│  ┌────────────────────┐   ┌─────────────────────┐  │
│  │ AI 能力层(LLM/VLM)  │   │ 语义索引              │  │
│  │ 打标签/摘要/RAG问答/ │   │ 向量分块存储(版本化)   │  │
│  │ 看图/查询扩展        │   │ 余弦检索 + RRF 合并   │  │
│  └────────────────────┘   └─────────────────────┘  │
│              Prisma ORM + SQLite（单文件）            │
└────────────────────────────────────────────────────┘
```

> Web 原型以服务端 LLM/VLM 模拟文档规划的「端侧推理」，接口形态与开发文档的
> `LlmProvider` 抽象一致；正式 Flutter 端将切换为 flutter_gemma 端侧模型（文档 D1）。

## 仓库结构

```
forgotIt/
├── README.md               ← 你在这里
├── forgotIt开发文档.md       产品 / 架构 / 数据模型 / Prompt / 工程规范（v2.0）
├── forgotIt部署文档.md       本地开发、生产部署、AI 配置、运维与排障
└── web/                    Web 原型 v1.2（Next.js 16 + Prisma/SQLite + NextAuth）
    ├── README.md           开发指南、API 一览、关键实现说明
    ├── prisma/schema.prisma
    ├── public/
    ├── scripts/            hash-password 密码哈希 CLI
    └── src/
        ├── app/            单页应用 + 登录页 + 18 个 API 路由
        ├── components/     13 个业务组件 + shadcn/ui
        ├── proxy.ts        全站门禁（未登录：API 401 / 页面跳登录）
        └── lib/            ai / embedding / search / sync / auth / local-first
```

## 快速开始

```bash
git clone https://github.com/lxygithub/forgotIt.git
cd forgotIt/web
cp .env.example .env        # 配 SQLite 路径与登录账号（AUTH_USERNAME / AUTH_PASSWORD）
bun install                 # 或 npm install
bun run db:push             # 初始化数据库（自动生成 Prisma Client）
bun run dev                 # 打开 http://localhost:3000，用 .env 里的账号登录
```

打开后首次会先见到登录门禁（「私有仓库，店主请出示钥匙」），用 `.env` 里的账号密码进入；首次是空状态，点击插画旁的「**载入示例**」即可灌入一组演示笔记（含发票图、体检报告、健身计划等），体验 AI 整理、语义搜索与问答。

> ⚠️ 两个实测过的坑：① 若 shell 里已 `export DATABASE_URL=...`，它会**覆盖** `.env`；
> ② 生产构建（standalone）下 SQLite 相对路径会解析失败，**必须用绝对路径**。
> 详见[部署文档](./forgotIt部署文档.md#常见问题排查)。

## 环境变量

| 变量 | 必填 | 默认 / 示例 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | `file:../db/custom.db`（开发） | SQLite 连接串；生产请用绝对路径如 `file:/var/lib/forgotit/custom.db` |
| `NEXTAUTH_SECRET` | ✅ | `openssl rand -base64 32` | 登录会话签名密钥（生产修改后需重新 build） |
| `AUTH_USERNAME` / `AUTH_PASSWORD(_HASH)` | ✅ | `owner` / 明文或 scrypt 哈希 | 单用户登录凭证；生产推荐哈希（`bun run hash-password` 生成） |
| `NEXTAUTH_URL` | 生产 ✅ | `https://notes.example.com` | NextAuth 回调基准地址 |
| `PORT` | — | `3000` | 生产 standalone 监听端口 |
| `.z-ai-config` | AI 功能需要 | 见[部署文档 §5](./forgotIt部署文档.md#5-ai-能力配置) | Z.ai 凭证文件（`{"baseUrl": "...", "apiKey": "..."}`），放在项目目录 / `~` / `/etc` 任一处 |

**AI 能力降级**：未配置凭证时，笔记增删改、关键词搜索、同步、回收站等基础功能完全可用；AI 整理、问答、图片理解、语义索引构建会返回错误提示。

## 技术栈

- **框架**：Next.js 16（App Router）+ React 19 + TypeScript
- **UI**：Tailwind CSS 4 + shadcn/ui + Lucide 图标 + framer-motion
- **数据**：Prisma ORM + SQLite（单文件，`db/custom.db`）；生产可平滑迁移 PostgreSQL + pgvector；**双部署支持**（Node 走文件库，Cloudflare Workers 走 D1）
- **状态**：Zustand（同步引擎 / 本地覆盖层）+ localStorage（outbox、游标、设备 ID）
- **AI**：内置平台中立 fetch 层（环境变量优先 → `.z-ai-config` 文件兑底），Prompt 规范对齐开发文档第 16 节

## 路线图

- [x] Web 原型 v1.0：笔记 / AI 整理 / RAG 问答 / 标签 / 回收站 / 主题
- [x] Web 原型 v1.1：语义向量搜索（RRF 混合检索）+ 多设备同步（LWW + 冲突快照）
- [x] Web 原型 v1.2：单用户鉴权（NextAuth 密码门禁）+ README 与部署文档
- [x] Web 原型 v1.3：双部署支持（同一代码库 Node + Cloudflare Workers/D1/R2，环境变量切换；Next 升级 16.3.5，AI 层平台中立化）
- [x] 原生移动端开发文档 v1.0（Android/iOS=Flutter，鸿蒙=ArkTS，含 API 契约/同步协议/一致性基准，供本机 AI 执行）
- [ ] Flutter App（Android + iOS，flutter_gemma 端侧推理，见开发文档 §15 与原生移动端开发文档 §8）
- [ ] 鸿蒙 App（HarmonyOS NEXT 原生 ArkTS，见原生移动端开发文档 §9）
- [ ] 生产级检索：PostgreSQL + pgvector + 真实 Embedding 模型（`gemma-embedding-768`）
- [ ] 附件 / OCR 文本入向量索引（`attachments.description/ocrText` 已预留）
- [ ] 远期：CRDT 合并策略（开发文档 §11 D6 备选）

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [forgotIt开发文档.md](./forgotIt开发文档.md) | 完整产品与技术方案 v2.0：决策日志 D1-D9、模型选型、数据模型、同步/RAG 设计、Prompt 规范、测试与合规 |
| [forgotIt原生移动端开发文档.md](./forgotIt原生移动端开发文档.md) | Android/iOS（Flutter）与鸿蒙（ArkTS）原生客户端开发文档：服务端对接契约（NextAuth 登录流）、LWW 同步协议精确规范、三端一致的端侧检索算法与对拍基准、页面规格、安全合规、里程碑 M0-M4/H1-H2 |
| [forgotIt部署文档.md](./forgotIt部署文档.md) | 环境要求、本地/生产部署（systemd / PM2 / Docker）、AI 凭证配置、数据库运维、Cloudflare Workers 可选路线（§11）、常见问题（含实测坑点） |
| [web/README.md](./web/README.md) | Web 端目录结构、开发命令、API 一览（含鉴权）、语义检索 / 同步 / 鉴权实现说明 |
