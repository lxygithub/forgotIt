# 记不住（ForgotIt）原生移动端开发文档

> **版本**：v1.0 ｜ **生成**：基于 Web 原型 v1.2 实际代码行为编写（非设想稿）
> **读者**：负责开发的 AI 助手 / 工程师
> **范围**：Android + iOS（Flutter 单代码库）＋ 鸿蒙 HarmonyOS NEXT（ArkTS 原生）
> **配套文档**：《forgotIt开发文档.md》v2.0（产品与 Prompt 权威）、《forgotIt部署文档.md》（服务器搭建）、`web/README.md`（API 逐端点签名）

---

## 0. 文档导读与执行约定（给开发 AI 的第一段话）

1. **本文档是移动端的唯一事实标准（Single Source of Truth）**。与《forgotIt开发文档.md》v2.0 冲突之处（尤其是后端部分），**以本文档为准**。原因：v2.0 第 6 节设想的是 FastAPI 后端，而实际已交付的后端是本仓库 `web/` 目录的 Next.js 实现（Prisma/SQLite + NextAuth），移动端必须对接**真实存在**的服务端。
2. **契约常量禁止擅改**：API 路径、字段名（camelCase）、同步状态机、`hash-ngram-zh-v1` 算法参数（第 6 节）一旦实现即冻结；确需变更必须先在本文档记录新决策。
3. **按里程碑推进**（第 12 节）：M0 → M1 → M2 → M3（Flutter）；H1 → H2（鸿蒙）。每个里程碑有明确验收清单，全部通过才进入下一个。
4. **先跑通联调环境再写 UI**：M0 用真实服务器（自己部署 `web/`，参照部署文档）把鉴权、CRUD、同步三个 curl 链路跑通，再开始写客户端。
5. **所有 AI 生成内容必须可离线降级**：端侧模型不可用时，功能不能崩溃，只能降级（第 7.5 节降级矩阵）。
6. **测试向量必须对拍**（第 6.10 / 附录 C）：三端的哈希与向量实现必须逐位一致，用附录 C 的基准值写自动化测试。
7. 敏感信息（密码、token、服务器地址）一律不入库、不写死在代码，运行时配置。

---

## 1. 决策记录（增量）

| # | 决策 | 内容 | 依据 |
|---|------|------|------|
| D10 | Android + iOS 统一 Flutter | 单代码库交付双端，UI/业务/同步/检索全共享；继承 v2.0 文档的 flutter_gemma 端侧方案 | 用户决策（2025） |
| D11 | 鸿蒙使用原生 ArkTS | HarmonyOS NEXT 不支持 Flutter 生态主线的稳定方案；采用 ArkTS + ArkUI + Stage 模型原生开发 | 用户决策（2025） |
| D12 | 服务端契约以 Web 原型为准 | Next.js 实现的 21 个端点、NextAuth Cookie 会话、LWW+seq 游标同步，即本节 4/5 章全部内容 | 实际交付物 |
| D13 | 端侧检索基线 = hash-ngram-zh-v1 | 三端本地实现同一 256 维哈希向量算法（第 6 节），零模型依赖即可语义检索；后续可插拔 Gemma Embedding | Web 原型已验证 |
| D14 | 端侧 LLM 分端策略 | Flutter：flutter_gemma（LiteRT .task/.litertlm，Gemma 系）；鸿蒙：v1 云端优先，端侧 LLM 为进阶项（MindSpore Lite） | 平台生态现状 |
| D15 | local_only 端侧真本地 | 设备端 `local_only` 笔记只存在于本机数据库，**永不出端**（比 Web 版更严格：Web 版受架构限制其"仅本地"仍存于自家服务器） | 隐私优先 U5 |

---

## 2. 产品规格摘要（权威细目见开发文档 v2.0 第 13/14 节）

- **产品名**：记不住（ForgotIt）｜ Slogan：**脑子寄存处** ｜ 副标语：你记不住的，它都记得住。
- **单用户私有应用**：一个服务器只服务一名店主（owner），移动端需要「服务器地址 + 用户名 + 密码」三要素登录。
- **核心页面**（六页 + 设置）：笔记列表 / 笔记编辑器 / AI 问答 / 标签 / 回收站 / 同步与设备（冲突处置）/ 设置。
- **核心交互**（与 Web 原型行为对齐）：
  - 新建笔记 < 2s；Markdown 源码/预览切换；自动保存（停顿 2s 或退出时落库），显示「已保存/待同步」。
  - 列表项 = 类型图标 + 标题 + 摘要（AI ≤50 字）+ 标签胶囊（类目在前，≤3 个 +「+n」）+ 缩略图 + 相对时间 + 置顶角标 + 待同步徽章。
  - 图片：相册/拍照入库 → 先传服务器（`/api/ai/attachments`）→ VLM 生成描述（「正在看图…」）→ 建笔记时以 `attachmentIds` 挂载。
  - AI 整理：保存后可触发（服务端端点或端侧模型），产出类目(≤1) + 自由标签(3-6, ≤8字) + 摘要(≤50字) + 语义关键词，toast「已帮你归类。不用谢，反正你下次也找不到。」
  - 问答：检索→生成→回答内联 `[1]` 引用标记 → 引用卡片可点击跳转笔记；资料不足必须回答「没找到相关记录」，禁止编造。
  - 回收站：软删除 30 天，剩余天数徽章（≤5 天警示色），恢复 / 彻底删除（二次确认）。
  - 搜索三模式 chips：关键词 / 语义 / 混合；语义模式展示「扩展词」。
  - 固定类目树（9 个，禁改名单见 4.4 节）：生活/工作/学习/财务票据/健康/旅行/灵感速记/人际/代码技术。
- **品牌文案**：全部 UI 文案使用附录 B 文案包常量，**原样使用，禁止改写**（品牌人设是「随和但靠谱的脑子管理员」）。

---

## 3. 总体架构

```text
┌───────────────────────────  设备端（三端同构分层） ───────────────────────────┐
│                                                                              │
│  UI 层（页面/组件）                                                          │
│    Flutter: Riverpod + go_router        ArkTS: ArkUI Navigation + Tabs      │
│  ────────────────────────────────────────────────────────────────────────   │
│  业务层（Controller/Service）                                               │
│    笔记 CRUD 编排 / 自动保存 / AI 任务路由 / 冲突处置 UX                      │
│  ────────────────────────────────────────────────────────────────────────   │
│  数据层（本地优先 = 真相在此）                                               │
│    SQLite 库：notes/tags/note_tags/attachments/embeddings/outbox/           │
│              tombstones/sync_state/settings（DDL 见 3.2）                    │
│  ───────────────────────────────┬─────────────────────────────────────────  │
│  同步引擎（outbox + LWW + seq）   │  检索引擎（FTS/LIKE + hash-ngram + RRF）  │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │ HTTPS + Cookie 会话（JSON, camelCase）
┌──────────────────────────────────▼──────────────────────────────────────────┐
│  自建服务器 = 本仓库 web/（Next.js 16 + Prisma/SQLite + NextAuth）           │
│  /api/notes  /api/ai/*  /api/search/*  /api/sync/*  /api/auth/*  /uploads/* │
│  （未来替换 FastAPI+PostgreSQL 时，只要契约不变，移动端零改动）               │
└─────────────────────────────────────────────────────────────────────────────┘
```

**三条铁律**：

1. **本地优先**：所有读写先落本地 SQLite，网络是异步增强。离线时全功能可用（除云端 AI），联网后自动同步。
2. **单一出云通道**：出网请求只允许出现在网络层模块（`ApiClient`/`HttpService`）与同步引擎；UI 与业务层禁止直接发请求。
3. **local_only 永不出端**：`local_only=1` 的笔记不入 outbox、不调用任何 /api 端点、图片不上传（D15）。

### 3.2 本地数据库 DDL（三端统一，SQLite 方言）

Flutter（drift 表定义映射此 DDL）与鸿蒙（RelationalStore 执行此 DDL）必须使用同一结构：

```sql
CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,              -- 客户端生成 UUID v4（离线新建即定 id）
  type          TEXT NOT NULL DEFAULT 'text',  -- text | image | mixed
  title         TEXT,
  content       TEXT,                          -- Markdown
  summary       TEXT,
  semantic_keywords TEXT,                      -- JSON string[]，与服务器 semanticKeywords 同构
  local_only    INTEGER NOT NULL DEFAULT 0,
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,                 -- ISO 8601 UTC，例 2025-01-15T08:30:00.000Z
  updated_at    TEXT NOT NULL,                 -- LWW 依据，客户端时钟，上传时必传
  deleted_at    TEXT,                          -- 软删除（回收站 30 天）
  version       INTEGER NOT NULL DEFAULT 1,    -- 与服务器 version 对齐
  dirty         INTEGER NOT NULL DEFAULT 0     -- 1=有未同步变更（outbox 里有它）
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,   -- category | free
  parent_id TEXT, color TEXT, created_at TEXT NOT NULL,
  UNIQUE(name, kind)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL, tag_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',           -- ai | user；user 手改后 AI 不覆盖
  PRIMARY KEY(note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, note_id TEXT,
  local_path TEXT,                               -- 设备上的本地文件
  remote_path TEXT,                              -- 服务器 /uploads/xxx.jpg（synced=1 后有值）
  mime_type TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
  width INTEGER, height INTEGER,
  description TEXT, ocr_text TEXT,               -- VLM 描述 / OCR 文本（入检索索引）
  synced INTEGER NOT NULL DEFAULT 0,             -- 0=仅本地，1=已上传
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  note_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
  model_name TEXT NOT NULL DEFAULT 'hash-ngram-zh-v1',
  model_version INTEGER NOT NULL DEFAULT 1,
  dim INTEGER NOT NULL DEFAULT 256,
  vector TEXT NOT NULL,                          -- JSON number[]（L2 归一化，5 位小数）
  PRIMARY KEY(note_id, chunk_index, model_name)
);

CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,         -- 严格按序推送
  entity TEXT NOT NULL,                          -- 'note'
  op TEXT NOT NULL,                              -- 'upsert' | 'delete'
  payload TEXT NOT NULL,                         -- JSON：SyncPushChange.data 全量
  created_at TEXT NOT NULL,
  retry INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT
);

CREATE TABLE IF NOT EXISTS tombstones (
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, deleted_at TEXT NOT NULL,
  PRIMARY KEY(entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL      -- device_id / pull_cursor / last_sync_at
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL      -- server_url / username / ai_mode / model_path ...
);
```

- 时间字段一律存 ISO 8601 UTC 字符串（与 API 一致），展示时转本地时区。
- 关键词全文索引：Android/iOS 可建 FTS5 虚表 `search_index(note_id UNINDEXED, title, content, ocr)`；鸿蒙 RelationalStore 若无 FTS5 则用 `LIKE` + tokenize 词表兜底——**接口统一为 `SearchEngine.search(keyword)`**，平台差异封装在实现内。

---

## 4. 服务端对接规范（事实标准）

服务器 = 本仓库 `web/`。部署方式见《forgotIt部署文档.md》。所有请求 `Content-Type: application/json`（鉴权回调除外），所有响应 JSON，**字段 camelCase**。所有时间 ISO 8601 UTC。

### 4.1 鉴权（NextAuth v4 Credentials + Cookie 会话）

单用户模型，凭证 = `AUTH_USERNAME` + `AUTH_PASSWORD(_HASH)`（服务端环境变量）。移动端登录流程（**必须完整实现，含 CSRF**）：

```text
① 拿 CSRF token
   GET  {BASE}/api/auth/csrf
   ←    200 {"csrfToken": "<token>"}
   ⚠    响应含 Set-Cookie: next-auth.csrf-token=...（必须保存，与下一步配对）

② 提交登录（表单编码，不是 JSON！）
   POST {BASE}/api/auth/callback/credentials
   Content-Type: application/x-www-form-urlencoded
   Body: csrfToken=<①的token>&username=<店主名>&password=<密码>&json=true
   ←    200 {"url": "..."}（json=true 时）
   ⚠    响应含 Set-Cookie: next-auth.session-token=<JWT>（HTTP 明文部署）
        或 __Secure-next-auth.session-token=<JWT>（HTTPS 部署）
        这是会话凭证，安全存储（Keychain / Keystore+EncryptedSharedPreferences / HUKS），有效期 30 天

③ 校验会话
   GET  {BASE}/api/auth/session   （携带会话 Cookie）
   ←    200 {"user":{"name":"owner"},"expires":"..."}   已登录
   ←    200 {}                                          未登录

④ 之后所有 /api/* 与 /uploads/* 请求都带 Cookie 头
⑤ 登出（可选）
   POST {BASE}/api/auth/signout  Body: csrfToken=<token>  → 服务端清除会话
```

- **会话失效判定**：任何 `/api/*` 返回 `401 {"error":"未登录或会话已过期"}` → 清除本地会话 → 跳登录页。
- **凭证存储**：用户名明文可存；密码**不落盘**（只在登录时使用）；会话 Cookie 存安全区。
- **服务器地址**（BASE）由用户在设置页输入，存 `settings.server_url`；登录前必须 `GET {BASE}/api/auth/csrf` 连通性预检（超时 10s 报「服务器连不上」）。
- 三端 Cookie 处理：Flutter 用 `dio` + `PersistCookieJar`（自动）；鸿蒙 `@ohos.net.http` 无 CookieJar，**手动**从响应头收集 `Set-Cookie`、随请求回放（封装进 HttpService，见 9.4）。

### 4.2 DTO 字段表（与服务器 JSON 一字不差）

```text
NoteDto {
  id: string                    服务器主键（客户端 UUID 会被原样接受）
  type: 'text'|'image'|'mixed'
  title: string|null
  content: string|null          Markdown 正文
  summary: string|null          AI 摘要 ≤50 字
  localOnly: boolean
  pinned: boolean
  createdAt: string             ISO 8601 UTC
  updatedAt: string             ISO 8601 UTC（LWW 依据）
  deletedAt: string|null        非 null = 回收站中
  tags: TagDto[]                类目在前、自由标签在后（服务器已排序）
  attachments: AttachmentDto[]  按 createdAt 升序
}
TagDto        { id, name, kind:'category'|'free', color:string|null, source?:'ai'|'user' }
AttachmentDto { id, filePath:'/uploads/xxx.jpg', mimeType, description:string|null,
                ocrText:string|null, createdAt }
StatsDto      { notes, images, tags, trash }
AskCitation   { noteId, title, snippet }
AskResult     { answer: string, citations: AskCitation[] }   // answer 内含 [1] 式标记
SearchHitDto  { note: NoteDto, keywordRank: number|null, semanticRank: number|null, rrfScore: number }
SemanticResult{ notes: NoteDto[], expansions: string[] }
ConflictDto   { id, noteId, noteTitle, losingDevice, losingUpdatedAt, losingTitle, losingContent,
                winnerUpdatedAt, winnerTitle, winnerContent, createdAt }
```

注意：服务器 JSON 中 `semanticKeywords` 不出现在 NoteDto（它是同步专用字段，见 5.2）；客户端本地库的 `semantic_keywords` 由端侧/服务端 AI 生成后仅用于本地检索与 push 上报。

### 4.3 API 全量契约（21 端点）

鉴权外所有端点未登录返回 `401 {"error": "..."}`。`{id}` 均为笔记 id。

| # | 端点 | 方法 | 请求 | 成功响应 |
|---|------|------|------|---------|
| 1 | `/api/notes` | GET | `?q=&type=text|image&pinned=1&tagId=&view=trash` 全部可选 | `{notes: NoteDto[]}` |
| 2 | `/api/notes` | POST | `{title?, content?, type?, localOnly?, attachmentIds?}` | `{note: NoteDto}` |
| 3 | `/api/notes/{id}` | GET | — | `{note}` |
| 4 | `/api/notes/{id}` | PUT | `{title?, content?, pinned?, localOnly?, type?}` 全部可选 | `{note}` |
| 5 | `/api/notes/{id}` | DELETE | `?permanent=1` 可选（缺省=软删） | `{ok:true}` |
| 6 | `/api/notes/{id}/restore` | POST | — | `{note}` |
| 7 | `/api/notes/{id}/ai-organize` | POST | — | `{note}`（含新 tags/summary/semanticKeywords 仅服务器侧可见部分） |
| 8 | `/api/ai/ask` | POST | `{question: string}` | `AskResult` |
| 9 | `/api/ai/attachments` | POST | `{noteId?, dataUrl: "data:image/jpeg;base64,...", mimeType}` | `{attachment: AttachmentDto}` |
| 10 | `/api/tags` | GET | — | `{categories: TagWithCount[], free: TagWithCount[]}` |
| 11 | `/api/stats` | GET | — | `StatsDto` |
| 12 | `/api/seed` | POST | — | `{ok:true}`（联调用：写入 5 条示例笔记） |
| 13 | `/api/search/semantic` | POST | `{query}` | `SemanticResult` |
| 14 | `/api/search/hybrid` | POST | `{query}` | `{hits: SearchHitDto[], expansions: string[]}` |
| 15 | `/api/ai/reindex` | POST | — | `{ok, indexed, keywordsGenerated}` |
| 16 | `/api/sync/push` | POST | `{deviceId, changes: SyncPushChange[]}` ≤100 条 | `{results: SyncPushResult[], serverTime}` |
| 17 | `/api/sync/pull` | GET | `?since=<cursor>` | `{cursor, changes: SyncPullChange[], serverTime}` |
| 18 | `/api/sync/conflicts` | GET | — | `{conflicts: ConflictDto[]}` |
| 19 | `/api/sync/conflicts` | POST | `{id, action:'restore-mine'|'discard'}` | `{ok, note?}` |
| 20 | `/api/auth/*` | GET/POST | NextAuth 流程（4.1） | 见 4.1 |
| 21 | `/uploads/{file}` | GET | — | 图片字节（**需会话 Cookie**，否则 302→/login） |

补充语义：

- **#2 localOnly 警告**：服务器接受 `localOnly:true` 的创建（这是 Web 版行为），但移动端 **禁止**对 localOnly 笔记调用任何 API（D15）。`attachmentIds` 挂载后服务器自动重算 `type`（有图有文=mixed，有图=image，纯文=text），客户端无需自算 type，本地库自算规则同（见 `computeType`）。
- **#7 响应的 tags** 服务器会返回打标结果，但**标签不在同步契约内**（附录 D）：端侧 organize 的标签结果只落本地库。
- **#9 上传是 dataUrl JSON**，不是 multipart。图片先在端上压缩到 ≤1600px 长边 / JPEG q80再 base64。
- **#16/#17/#19 详细语义见第 5 节（同步协议）**。
- `TagWithCount = TagDto & {count:number}`；固定类目服务器缺省自动建（9 类目名单在服务器 `DEFAULT_CATEGORIES`），客户端首次同步后从 #10 拉取展示即可，不需要本地预置写入服务器。

### 4.4 错误处理统一规范

```text
非 2xx 响应体统一为 {"error": "<中文提示>"}（也可能纯文本）
- 401        → 会话失效：清会话 → 登录页（后台静默流程中则标记待重连）
- 400/404    → 展示 error 字段内容（toast）
- 5xx        → 「服务器开小差了，稍后再试」
- 网络异常    → 「网络请求失败，请稍后再试」；自动进入离线模式（同步引擎负责）
- 重试策略   → 幂等 GET 可自动重试 1 次；写操作重试由同步引擎统一负责（业务层禁止自行重试 POST/PUT/DELETE）
```

---

## 5. 同步协议精确规范（LWW + seq 游标）

对应服务器实现：`web/src/lib/sync-server.ts`（语义一字不差）。

### 5.1 设备标识

- `deviceId`：首启生成一次，永存 `sync_state`：`device-{flutter|harmony}-{8位随机}`，≤64 字符。
- 笔记 `id`：客户端 UUID v4（离线新建即定 id，服务器原样接受，无 id 映射问题）。

### 5.2 outbox（本地变更队列）

- **入队时机**：本地笔记 create / update / softDelete / 彻底删除 的同时（同一事务），写一条 outbox 并置 `dirty=1`。**localOnly 笔记不入队**。
- **payload 结构**（=`SyncPushChange`，直接 JSON 序列化入 outbox.payload）：

```jsonc
{
  "entity": "note",
  "op": "upsert",                    // upsert | delete（delete = 软删或彻底删）
  "data": {
    "id": "uuid-v4",
    "title": "…", "content": "…", "summary": "…",
    "semanticKeywords": "[\"体检\",\"复查\"]",   // JSON 字符串（string[] 的 JSON），无则 null
    "pinned": false, "localOnly": false,
    "type": "text",
    "deletedAt": null,               // 软删时=删除时间；upsert 恢复时=null
    "updatedAt": "2025-01-15T08:30:00.000Z",  // 必填！LWW 依据（客户端最后修改时间）
    "baseVersion": 3,                // 本地已知的服务器 version（可省略）
    "newVersion": 4                  // 本地递增后的 version（可省略）
  }
}
```

- 服务器对 `delete` op 的处理：`deletedAt` 写入服务器时间（若彻底删除，后续 pull 该 id 会下发 `note:null` 的删除指令）。

### 5.3 push 流程

```text
触发：outbox 非空且在线时（去抖 2s）/ 手动「立即同步」/ 网络恢复 / 定时 30s
① 取 outbox 按 seq 升序 ≤100 条 → POST /api/sync/push {deviceId, changes}
② 逐条处理 results（与 changes 按数组下标对应）：
   - applied        → 用返回 note 快照覆盖本地行（保留 dirty=0, version 对齐），
                      清除该 outbox 条目；注意返回的 noteId 若与 data.id 不同（客户端未传 id 时）需做映射
   - conflict       → 服务器更新：本地行覆盖为返回的 note 快照（dirty=0），
                      本地冲突记录表插入 {snapshotId: 服务器 ConflictSnapshot.id（GET conflicts 可见）,
                      myTitle/myContent（=被覆盖前本地内容）, serverTitle/serverContent}，UI 出冲突提示
   - local-only-skipped → 直接丢弃该条（防御：本不该入队），本地行保持 localOnly
   - invalid        → 记日志丢弃（数据不合法，不重试）
③ 全部处理完 → 若 outbox 仍有剩余 → 立即继续下一批（≤100/批）
④ 失败（网络/5xx）：retry+1，指数退避 5s→30s→2m→10m，5 次后转「手动同步」并出角标；
   outbox 顺序不能打乱（seq 严格递增推送）
```

### 5.4 pull 流程（push 成功后紧接着执行）

```text
① GET /api/sync/pull?since={pull_cursor}   （cursor 初值 0，存 sync_state）
② 返回 changes 按 seq 升序，逐条应用：
   op=upsert 且 note!=null：
     - 本地无此 id            → 插入（dirty=0，attachments/tags 全量替换）
     - 本地有且 dirty=1       → 跳过（本地有未推送修改，等 push 结果裁决，防覆盖）
     - 本地有且 dirty=0       → 仅当 note.updatedAt > 本地 updatedAt（严格大于）才覆盖；
                                相等或更旧 → 忽略（服务器 LWW 等值偏服务器，客户端幂等跳过）
   op=delete 或 note==null：
     - 本地 dirty=0           → 本地物理删除该行（含附件文件/向量），写 tombstone
     - 本地 dirty=1           → 跳过（push 会裁决）
③ 处理完后 pull_cursor = 返回 cursor，持久化
④ changes 非空 → 触发列表刷新 + 重建受影响笔记的本地向量索引
注意：changes ≤200 条/次，若恰好 200 条说明可能还有更多，立即用新 cursor 再拉，直到返回 <200
```

### 5.5 冲突处置 UX（与 Web 原型一致）

- 同步面板列出冲突（GET #18 拉取 + 本地 push 遇到的 conflict 合并去重），展示双版本对比（标题+内容）。
- 「用我的版本」→ POST #19 `{id, action:'restore-mine'}` → 服务器把落败方恢复为最新版 → 客户端 pull 即得；本地冲突记录清除。
- 「丢弃」→ POST #19 `{action:'discard'}` → 本地覆盖的快照保持服务器版。

### 5.6 触发与状态

- 触发：App 启动 / 前台恢复 / `connectivity` 变为在线 / 每 30s 定时 / 手动。四者共用一把互斥锁（同一时刻仅一个同步周期）。
- UI 状态三态：`idle / syncing / offline`；顶栏同步角标显示 outbox 待推数量（>9 显示 9+）。
- **契约边界（重要）**：当前同步契约只覆盖 **notes 正文字段**；tags、attachments **不参与 push/pull**（附录 D）。附件的出云走 #9 上传（在线时立即传，`synced=1`），下载按 `remote_path` 懒加载缓存。

---

## 6. 端侧检索基线算法：hash-ngram-zh-v1（三端逐位一致）

对应服务器实现：`web/src/lib/embedding.ts`。三端必须实现**完全一致**，附录 C 基准值用于自动化对拍。算法本质：fastText 风格的加权哈希向量（character n-gram hashing），零模型、零依赖、毫秒级。

### 6.1 常量（冻结）

```text
MODEL_NAME    = "hash-ngram-zh-v1"
MODEL_VERSION = 1
DIM           = 256
CHUNK_SIZE    = 500      # 字符
CHUNK_OVERLAP = 60
MAX_CHUNKS    = 4        # 每条笔记最多 4 块
RRF_K         = 60       # 混合检索 RRF 常数
SEMANTIC_MIN_SCORE = 0.05   # 语义检索结果最低余弦分
```

### 6.2 文本规整 normalizeText

```text
1. Unicode NFKC 归一化
2. 转小写
3. 删除 Markdown 语法字符，替换为空格：正则 [#*_`~>\-|!\[\]()]+（中括号圆括号均为半角）
4. 连续空白折叠为单个空格，首尾去空
```

### 6.3 分词 tokenize（产出 token + 权重序列）

```text
输入 = normalizeText(文本)
A. 提取所有 CJK 连续段（正则 [\u4e00-\u9fa5]+）：
   - 每个单字 → token, weight=1
   - 每个相邻二元组（bigram，滑窗 step=1）→ token, weight=2
     例 run="体检报告" → 体:1 检:1 报:1 告:1 体检:2 检报:2 报告:2
B. 提取所有拉丁/数字词（正则 [a-z0-9][a-z0-9+#.]{1,}，即首字符字母数字、后续可含 + # .）：
   - 整词 → token, weight=2
   例 "ai2024" 是一个词（首字符字母后接数字）；"2024" 也是一个词
顺序：先输出全部 CJK 段的 token，再输出全部拉丁词的 token（顺序不影响向量，只影响可复现性）
```

⚠ **字符编码陷阱**：token 遍历与哈希的字符单位必须是 **UTF-16 code unit**（与 JS `charCodeAt` 一致）。Kotlin 的 `Char.code` 天然是 UTF-16；Swift **必须**用 `text.utf16` 迭代（不能用 Character/UnicodeScalar，emoji 会不一致）；ArkTS/TS 与 JS 同源天然一致。

### 6.4 FNV-1a 32 位哈希

```text
h = 0x811c9dc5
for each UTF-16 code unit c in token:
    h = h XOR c          # 32 位异或
    h = h * 0x01000193   # 32 位乘法，只保留低 32 位（溢出回绕）
return h as unsigned 32-bit
```

- Kotlin：`Int` 乘法天然回绕，与 JS `Math.imul` 语义一致；输出 `toLong() and 0xFFFFFFFFL`。
- Swift：用 `UInt32` 与运算符 `&^`（异或）、`&*`（回绕乘法）。
- ArkTS/TS：与 JS 相同，`Math.imul` + `>>> 0`。
- 索引映射：`idx = h % 256`；符号：`sign = (h >>> 31) & 1 ? -1 : +1`（即最高位为 1 取负）。

### 6.5 加权向量 embedWeighted

```text
vec = float64[256] 全 0
for part in parts:                       # part = (text, weight)
    for (token, tw) in tokenize(part.text):
        h = fnv1a(token)
        vec[h % 256] += sign(h) * tw * part.weight
norm = L2 范数(vec)
若 norm == 0 → 返回 256 维全 0
否则 vec[i] = round(vec[i] / norm, 5)    # 四舍五入到 5 位小数（与服务器 toFixed(5) 一致）
```

### 6.6 分块 chunkContent

```text
1. 先删除成对 ``` 代码块（正则 ```[\s\S]*?``` 替换为空格），trim；空 → []
2. 总长 ≤500 → 单块返回
3. 否则按换行（单换行也算）切段落，trim 后依次聚块：
   - 段落 >500：先把当前缓冲 flush，再按步长 (500-60)=440 硬切，累计达 4 块即止
   - (缓冲+换行+段落) >500：flush 缓冲，段落成为新缓冲
   - 否则段落并入缓冲（\n 连接）
4. 尾缓冲 flush；最终 slice(0, 4)
正文为空 → 有效块 = [""]（空字符串块，仍生成向量=全 0）
```

### 6.7 笔记加权部件 noteToEmbedParts（对齐服务器）

```text
标题 title（非空）            → weight 3
摘要 summary（非空）          → weight 2
semanticKeywords 每个关键词   → weight 4
本地标签 tag.name 每个        → weight 2
附件 description 每个（非空） → weight 2
附件 ocrText 前 300 字符      → weight 2
正文块（每个 chunk 分别与上述部件合并计算一次向量）→ weight 1
即：第 i 块的向量 = embedWeighted(所有加权部件 + {chunk_i, 1})
无正文 → chunks = [""]，仍生成 1 条向量
```

### 6.8 余弦相似度

向量已 L2 归一化，直接点积即可；实现通用公式 `dot/(|a||b|)` 兜底，任一零向量返回 0。

### 6.9 本地检索编排（SearchEngine）

```text
关键词检索：FTS5/LIKE 命中 → 按相关度排序（title 命中权重 > content）
语义检索：query 向量化（embedText(query,1)）→ 与 embeddings 全表余弦 →
          按笔记取最高分块分 → 过滤 score>0.05 → 降序取 top10
混合检索：两路各排名 → RRF 合并：score(d) = Σ 1/(RRF_K + rank_i)，k=60，降序
查询扩展（可选增强）：若端侧 LLM 可用，先产出 5-8 个同义/相关词，把原查询与扩展词
          的向量分别检索后按 RRF 合并；扩展词 UI 展示（品牌：语义模式提示）
```

### 6.10 三端一致性对拍（必做自动化测试）

对拍基准见**附录 C**。每个平台的单元测试至少包含：附录 C 的 10 个 token 哈希值全等；`embed("体检报告")` 与 `embed(多部件)` 的非零维坐标与数值全等（±0；因有 5 位小数舍入，允许 ±1e-5 以内误差，但目标为全等）；两条余弦值误差 ≤0.0001。

---

## 7. AI 能力分层与 Prompt 规范

### 7.1 任务清单与路由

| 任务 | 云端模式（走服务器） | 端侧模式（Flutter only，v1 鸿蒙不做） | 都不可用时 |
|------|---------------------|--------------------------------------|-----------|
| 自动整理（类目+标签+摘要+关键词） | POST #7 `ai-organize` | 端侧 LLM 推理（7.4 P1） | 规则兜底：正则抽取关键词作自由标签，无摘要 |
| 摘要 | #7 同上 | 端侧 P2 | 无 |
| RAG 问答 | POST #8 `ai/ask` | 端侧 P3（检索 top5 → Prompt） | 「没找到相关记录」+ 提示可用云端 |
| 查询扩展 | #14 服务器自动 | 端侧 P4 | 跳过扩展 |
| 图片理解 VLM | #9 上传后服务器生成 description | 不做（归一化走服务器） | 无描述，仅 OCR |
| OCR | 服务器不做 OCR（Web 版无） | **flutter_paddle_ocr 端侧** | 无 |

- AI 模式三态（品牌文案见附录 B）：`本地 / 云端 / 自动`；自动 = 端侧模型就绪用端侧，否则云端，再否则规则兜底。
- **local_only 笔记在任何模式下都禁止云端任务**（端侧可以）。
- 端侧推理完成后，结果同样走「写本地库 → 入 outbox」通道，与手动编辑无差别。

### 7.2 Prompt 模板（权威 = 开发文档 v2.0 第 16 节，内联如下）

P1 自动整理（temperature 0.3，JSON 输出）：

```text
输入：标题 + 正文前 1500 tokens（+ 附件描述如有）
System/指令：
你是笔记整理助手。根据笔记内容输出 JSON：
{"category": "<类目>", "tags": ["<自由标签3-6个，每个≤8字>"], "summary": "<≤50字摘要>", "keywords": ["<语义关键词5-8个：同义词/相关概念>"]}
类目必须从以下枚举中选择：生活/工作/学习/财务票据/健康/旅行/灵感速记/人际/代码技术
只输出 JSON，不要多余文字。
容错：解析失败 → 附格式错误重试 1 次 → 正则兜底提取 → 静默失败记日志。
```

P2 摘要：正文前 2000 tokens → 输出 ≤50 字一句话摘要，无标点开头结尾修饰。

P3 RAG 问答（与服务器同款，回答必须带引用）：

```text
你是"记不住"的检索助手。仅依据下方资料回答用户问题。
规则：
1. 每个论断后标注来源编号，如 [1]。
2. 资料不足时，回答"没找到相关记录"，不得编造。
3. 用中文回答，简洁分点。
[资料]
[1] （笔记标题，日期）chunk 内容…
[2] …
```

P4 查询扩展：输出 JSON `{"expansions": ["同义词/相关词 5-8 个"]}`。
P5 图片理解（仅服务器执行）：输出 `{"description": "一句话描述", ...}`，精确文字交给 OCR，VLM 不逐字抄写。

### 7.3 端侧模型矩阵（Flutter）

| 用途 | 首选 | 格式 | 备注 |
|------|------|------|------|
| 文本生成（整理/摘要/问答/扩展） | flutter_gemma + **Gemma 3 1B int4**（.task）或 Gemma 3n E2B（.litertlm，性能允许时） | LiteRT | `flutter_gemma: ^ latest`，模型下载走应用内管理（Wi-Fi 默认），存应用沙箱 |
| 备选降级 | llamadart + 任意 1B GGUF（Q4_K_M） | GGUF | 与 flutter_gemma 二选一即可，通过 `LlmProvider` 抽象隔离 |
| OCR | flutter_paddle_ocr（PP-OCRv 系） | — | 文档 v2.0 已选型 |

- **抽象层铁律**：业务代码只依赖 `LlmProvider` 接口（`complete(prompt): String` / `chat(messages)`），具体引擎（flutter_gemma / llamadart / 云端代理）为可插拔实现（v2.0 文档 5.2 节原则）。
- 模型管理页：显示已下载模型、大小、删除、切换；下载用 `flutter_downloader` 或原生 API + 断点续传；SHA256 校验可选。
- 上下文预算：P3 检索 top-5 分块 ≈3000 tokens + 问题，1B 模型 4K 上下文即可安全。

---

## 8. Flutter 客户端（Android + iOS）详细设计

### 8.1 技术栈与版本

| 项 | 选型 | 说明 |
|----|------|------|
| Flutter / Dart | Flutter 3.3x stable / Dart 3.x | 以当期 stable 为准 |
| 状态管理 | flutter_riverpod（3.x，代码生成可选） | AsyncNotifier 管理「模型加载中/就绪/降级」 |
| 路由 | go_router | 登录页 + 主 Tab + 编辑器 + 设置 |
| 本地库 | drift ^2 + sqlite3_flutter_libs | 表定义严格映射 3.2 DDL |
| 序列化 | freezed + json_serializable | DTO 与 4.2 字段表一字不差 |
| 网络 | dio ^5 + cookie_jar（PersistCookieJar） | NextAuth Cookie 自动管理 |
| 安全存储 | flutter_secure_storage | 会话 Cookie 备份/迁移用（首选仍走 cookie_jar 持久化） |
| 端侧 LLM | flutter_gemma（LiteRT .task/.litertlm） | 经 LlmProvider 抽象 |
| OCR | flutter_paddle_ocr | 图片入库时抽取文本 |
| Markdown 渲染 | markdown_widget | 源码/预览双模式 |
| 图片 | image_picker + flutter_image_compress | 长边 ≤1600 / JPEG q80 |
| 后台 | workmanager | 网络恢复/周期同步（iOS 用 BGTaskScheduler 封装在插件内） |
| 其他 | uuid / intl / connectivity_plus / share_plus（可选） | |

### 8.2 工程结构（feature-first，文件级）

```text
lib/
  main.dart                     # 入口：初始化 DB/同步引擎/ Provider 容器
  app/
    router.dart                 # go_router：/login, /home(ShellRoute: notes|ask|tags|trash), /settings
    theme.dart                  # 主题：暖纸底浅色 + 暖褐深色；主色 amber(600/500)；圆角胶囊
    brand.dart                  # 附录 B 文案包常量（原样复制）
  core/
    db/
      tables.dart               # drift 表定义（3.2 DDL 映射）
      app_db.dart               # AppDatabase + schemaVersion 迁移策略
      daos/notes_dao.dart       # CRUD + dirty 管理 + outbox 联动（同事务）
      daos/search_dao.dart      # FTS5 维护与查询
    api/
      api_client.dart           # dio 实例 + CookieJar + 401 拦截器 + BASE 配置
      auth_api.dart             # 4.1 三步登录流（csrf → callback → session）
      notes_api.dart            # 契约表 #1-#7, #10-#12
      ai_api.dart               # #8 #9 #15
      search_api.dart           # #13 #14
      sync_api.dart             # #16-#19
    sync/
      sync_engine.dart          # 5.3/5.4 状态机（互斥锁 + 触发器）
      outbox.dart               # 入队/出队/退避
      conflict_store.dart       # 本地冲突记录
    ai/
      llm_provider.dart         # 抽象接口 + 云端代理实现（转发服务器 #7/#8）+ 本地实现
      gemma_provider.dart       # flutter_gemma 封装
      prompts.dart              # 7.2 P1-P5 模板
      ocr_service.dart          # flutter_paddle_ocr
    rag/
      embedding.dart            # 第 6 节算法（纯 Dart，零依赖）
      chunker.dart              # 6.6 分块
      search_engine.dart        # 6.9 检索编排
      indexer.dart              # 笔记向量索引维护（写入/删除联动）
  features/
    login/                     # 服务器地址+用户名+密码 三段式登录页
    notes/                     # 列表页(筛选 chips/卡片/滑动置顶删除) + 编辑器页(源码/预览/图片/仅本地开关)
    capture/                   # 拍照/相册入口（列表 FAB 长按出菜单）
    ask/                       # 问答页（流式/引用卡片/示例问题）
    tags/                      # 类目网格 + 标签云
    trash/                     # 回收站（剩余天数徽章/恢复/彻底删除）
    sync/                      # 同步面板（状态/设备/冲突对比/立即同步）
    settings/                  # AI 模式/模型管理/服务器配置/关于(许可证声明)
```

### 8.3 数据层要点

- drift 表 = 3.2 DDL 一一映射；`schemaVersion` 从 1 起，迁移走 `stepByStep`。
- **dirty 与 outbox 同事务**：任何笔记写操作在 `AppDb.transaction` 内完成「写 notes + 写 outbox + 置 dirty」三件事，防半成品状态。
- `computeType(attachmentCount, hasContent)`：>0图+有文=mixed；>0图=image；否则 text。挂载/卸载图片后重算。
- 附件文件存应用沙箱 `Documents/attachments/{id}.{ext}`；下载缓存 `Documents/uploads-cache/`（LRU 上限 200MB）。

### 8.4 同步引擎实现（伪代码级）

```dart
Future<void> syncLoop({required bool manual}) async {
  if (!mutex.tryAcquire()) return;            // 互斥
  try {
    if (!await connectivity.online) { state = offline; return; }
    await pushOutbox();                        // 5.3
    do { final r = await pull(cursor); apply(r); cursor = r.cursor; }
    while (r.changes.length == 200);           // 5.4 循环拉取
    state = idle; lastSyncAt = now;
  } on AuthExpired { gotoLogin(); }
  catch (e) { backoff(); state = idle; }
  finally { mutex.release(); }
}
```

- 触发器注册：启动后 1s、connectivity 恢复、Timer.periodic(30s)（仅前台）、手动。
- workmanager 后台任务：Android `BackgroundSyncWorker`（网络连通约束）；iOS BGAppRefreshTask（≤30s，只做一轮 push+pull 小批量）。

### 8.5 页面规格（对齐 Web 原型视觉/文案）

- **登录页**：三输入（服务器地址/用户名/密码）+ 登录按钮；文案用附录 B（「私有仓库，仅服务店主一人。请出示钥匙。」）；错误提示「钥匙不对。别急，想想再试。」
- **主框架**：底部 NavigationBar 四 Tab（笔记/问答/标签/回收站），顶栏 = Logo + 同步状态按钮（角标）+ 设置。
- **列表页**：搜索框（品牌 placeholder）+ 类型/置顶筛选 chips + 标签筛选 chip（可清除）+ 统计小字；卡片见 2 节；FAB「记一条」仅笔记 Tab 显示；空状态双态（无筛选=插画+「载入示例」(#12 seed)+「记一条」，有筛选无结果=没找到文案+清除筛选）。
- **编辑器**：全屏页；顶栏 源码/预览切换 + 保存；图片缩略图行（上传中「正在看图…」/ VLM 描述 tooltip）；「仅本地」Switch（开启后顶部黄色横幅提示隐私状态）；底部状态「已保存 HH:mm / 待同步」。
- **问答页**：聊天流（用户右/AI 左）+ Markdown 渲染 + 引用卡片（序号徽章→点击打开笔记）+ 三点跳动 loading + 空状态示例问题 chips（附录 B exampleQuestions）。
- **标签页**：固定类目 amber 实底卡网格（3 列）+ 自由标签云（字号随 count）。
- **回收站**：顶部提示条（trashHint）+ 每项剩余天数徽章（≤5 天警示色）+ 恢复 / 彻底删除（AlertDialog 确认）。
- **同步面板**（modal）：状态行 + 离线开关 + 立即同步 + 设备 id + 冲突列表（双版本对比 + 用我的版本/丢弃）。
- **设置页**：AI 模式三选（品牌文案）+ 模型管理（下载/删除）+ 服务器信息（只读展示 BASE/用户名 + 退出登录）+ 关于（许可证，见 10.3）。
- 触控目标 ≥44px；深色模式全量适配（暖褐底）；列表长按 = 多选（置顶/删除批量，可后置到 M2）。

### 8.6 平台差异

| 事项 | Android | iOS |
|------|---------|-----|
| 后台同步 | WorkManager（网络约束） | BGAppRefreshTask（系统调度，不保证及时） |
| 安全存储 | EncryptedSharedPreferences / Keystore | Keychain |
| 端侧加速 | GPU delegate（OpenCL） | CPU（Metal 视插件支持） |
| 分享接收 | intent-filter 接收 text/plain 与 image | 继承 UIScene 分享扩展（可后置） |
| 推送唤醒同步（可选） | FCM 数据消息 | APNs 静默推送（可后置 M4） |

### 8.7 构建与签名

- 版本：`MAJOR.MINOR.PATCH+build`，`pubspec.yaml` version 单源；Android `versionCode`/iOS build number 由此生成。
- Android：`key.properties`（不入库）+ `build.gradle` 读取；产物 `flutter build appbundle`（Play）/ `flutter build apk --release`（分发）。
- iOS：Xcode 手动签名或 fastlane match；产物 ipa → TestFlight。
- CI（GitHub Actions）：PR 跑 `flutter analyze` + `dart format --set-exit-if-changed` + `flutter test`（含 6.10 对拍测试 + LWW 单元测试）；main 跑 `flutter build apk --debug` 冒烟。macOS runner 才能构建 iOS（可后置）。

---

## 9. 鸿蒙客户端（HarmonyOS NEXT，ArkTS 原生）详细设计

### 9.1 技术栈与环境

| 项 | 选型 |
|----|------|
| 系统 | HarmonyOS NEXT 5.0+（API 12+，仅支持纯血鸿蒙，不考虑安卓兼容） |
| 语言 | ArkTS（严格模式：禁 any、禁运行时修改对象结构） |
| UI | ArkUI 声明式（Navigation + Tabs + List + @Builder） |
| 应用模型 | Stage 模型（UIAbility + EntryAbility） |
| 数据库 | @ohos.data.relationalStore（RdbStore，执行 3.2 DDL） |
| 网络 | @kit.NetworkKit（@ohos.net.http）；可选 Remote Communication Kit(rcp) |
| 后台 | 延迟任务 workScheduler（@ohos.resourceschedule.workScheduler）+ 长时任务（同步进行中切后台时） |
| 安全存储 | @ohos.security.asset（Asset Store Kit，存会话 Cookie） |
| OCR | Core Vision Kit（@kit.CoreVisionKit textRecognition） |
| 端侧 LLM | **v1 不做**（云端优先）；进阶项见 9.7 |
| IDE/构建 | DevEco Studio 5+ / hvigorw 命令行 |

### 9.2 工程结构

```text
entry/src/main/ets/
  entryability/EntryAbility.ets        # 入口：初始化 DB / 同步引擎 / 偏好
  app/                                 # 主题、品牌文案（附录 B 常量）、导航路由
  common/
    http/HttpService.ets               # @ohos.net.http 封装：BASE、CookieJar（手动）、401 拦截、重试
    db/Db.ets                          # RdbStore 初始化 + DDL（3.2）+ DAO
    db/NotesDao.ets / TagsDao.ets / OutboxDao.ets / SyncStateDao.ets
  core/
    sync/SyncEngine.ets                # 5.3/5.4 状态机（Promise 队列互斥）
    sync/Outbox.ets
    embedding/HashNgram.ets            # 第 6 节算法（TS 实现，与 Web 同构）
    embedding/SearchEngine.ets         # 6.9（LIKE + 向量 + RRF）
    ai/CloudAi.ets                     # 云端 AI（转发 #7/#8）
    ai/Router.ets                      # 任务路由（v1：云端 or 规则兜底）
  pages/
    LoginPage.ets                      # 服务器/用户名/密码
    Index.ets                          # Tabs: 笔记/问答/标签/回收站
    NoteList.ets / NoteEditor.ets      # 编辑器（源码/预览、图片、仅本地开关）
    AskPage.ets / TagsPage.ets / TrashPage.ets
    SyncPanel.ets（半模态 bindSheet）  # 状态/冲突对比/立即同步
    SettingsPage.ets                   # AI 模式/服务器信息/关于
resources/base/profile/main_pages.json  # 页面注册
module.json5                            # 权限：ohos.permission.INTERNET / GET_NETWORK_INFO
```

### 9.3 数据层要点

- RdbStore 单例；`version` 从 1 起，`onUpgrade` 逐版本迁移。
- ArkTS 无 ORM：DAO 手写 SQL + `ResultSet` 映射对象；事务用 `beginTransaction/commit/rollBack`。
- **dirty + outbox 同事务**（与 8.3 一致）。
- 大文本（content）读流注意 `resultSet.getString` 直接可用；向量存 JSON 字符串（与 Web 一致）。

### 9.4 网络层要点（Cookie 手动管理）

```text
HttpService.ets 职责：
1. 统一封装 request<T>(method, path, body?)：
   - 请求头注入：Cookie: <csrfCookie>; <sessionCookie>; Content-Type: application/json
2. 响应拦截：解析 setCookie 头（可能是数组），更新内存 Map + 持久化到 Asset
   - 会话 Cookie 名：next-auth.session-token 或 __Secure-next-auth.session-token
3. 401 → 清会话 → 通知 UI 切登录页
4. 登录流（4.1）：csrf GET → 读 setCookie 存 csrf token + cookie →
   callback POST（form-urlencoded：手动拼 body 字符串）→ 存 session cookie → session 校验
```

- 超时：连接 10s / 读 30s；图片上传 60s。
- `http.createHttp()` 每请求一个实例用后 `destroy()`，避免泄漏。

### 9.5 同步引擎

- 与 8.4 同一状态机；前台 30s 定时器 + workScheduler 延迟任务（设置 `isPersisted:true`、网络条件 NETWORK_TYPE_ANY）周期唤醒做一轮 push+pull。
- 长时任务：同步进行中若用户切后台，申请 `backgroundTaskManager` 短时窗口（DATA_TRANSFER）完成本轮。

### 9.6 UI 规格

- Navigation + Tabs 结构，四 Tab 与 8.5 相同；半模态 `bindSheet` 承载同步面板。
- 主题：浅色暖纸底 / 深色暖褐底，主色琥珀（#D97706 系）；品牌文案全量复用附录 B。
- 触控目标 ≥44vp；折叠屏/平板断点：≥600vp 双列网格。

### 9.7 端侧 AI 策略（鸿蒙）

- **v1**：AI 模式只有「云端 / 规则兜底」两档；图片理解走服务器；OCR 用 Core Vision Kit 端侧可做（非生成式，不受限）。
- **v2 进阶（可选）**：MindSpore Lite 加载端侧 LLM（需自行完成模型转换；华为 HiAI Foundation 大模型能力需商用合作授权）。接口预留 `LlmProvider` 抽象与 Flutter 端同名同语义，云端实现先行。

### 9.8 构建与上架

- 构建：`hvigorw assembleHap --mode module -p product=default`；签名用 AGC 下发的调试/发布证书（.p12 + .p7b + profile），材料不入库。
- 上架：AppGallery Connect 创建应用 → 隐私声明（本地优先/云端模式数据流向）→ 提审（个人开发者可用）。
- CI：DevEco 命令行工具链仅支持 macOS/Windows，GitHub Actions 无官方镜像 → **CI 可后置**，本地构建 + 手动上传 .hap 为 v1 常规流程；如需自动化用自托管 runner。

---

## 10. 安全与隐私

### 10.1 凭证与会话

| 平台 | 会话存储 | 说明 |
|------|---------|------|
| Flutter/iOS | Keychain（经 secure_storage） | 密码不落盘 |
| Flutter/Android | Keystore 加密的 EncryptedSharedPreferences | 同上 |
| 鸿蒙 | Asset Store Kit（关键资产） | 同上 |

- 会话 Cookie 有效期 30 天；刷新策略：401 后重新走登录流（凭证默认不存——**如需静默续期，可选设置项「记住密码」，明示风险后存安全区**）。
- 网络强制 HTTPS（设置页输入 http:// 时弹警告「明文传输，仅限内网测试」）。

### 10.2 local_only 强制（D15）

- 编辑器「仅本地」开关开启后：该笔记所有出网路径物理断开——不入 outbox、不进 AI 云端任务、图片不传 #9；代码层在 `ApiClient` 入口加断言（localOnly 上下文的请求直接抛错记日志）。
- 端侧 AI（Flutter）处理 localOnly 笔记不受限。

### 10.3 合规

- 「关于」页必须包含：Gemma 模型归属与许可链接（Gemma Terms of Use）、PP-OCR Apache-2.0 声明、第三方依赖清单（开发文档 v2.0 第 18 节）。
- 崩溃/日志：本地环形缓冲 500 条，可导出；**默认无任何上报**（如接 Sentry 必须 opt-in 且白名单：无笔记内容、无凭证）。

---

## 11. 测试计划与验收

### 11.1 单元测试（三端同名用例，命名对齐）

| 组 | 用例 |
|----|------|
| embedding（附录 C） | token 哈希 10 例全等 / embed 单文本 / embed 多部件 / cosine 两例 / chunk 边界（499/500/501/超长段落/代码块剔除） |
| LWW 合并 | 新覆旧 / 旧不覆新 / 等值服务器胜 / delete+edit 并发 / localOnly 拒收 / dirty 跳过 pull |
| outbox | 入队同事务 / ≤100 批次切分 / 退避序列 / 顺序保持 |
| DTO | 服务器 JSON 样例反序列化（null 全覆盖） |
| 检索 | 关键词/语义/混合三模式 + RRF 排序 + 扩展词注入 |

### 11.2 同步矩阵（双设备实机/双模拟器）

1. A 在线建 → B 30s 内拉到。2. A、B 同时改同一条 → LWW 一胜一快照，冲突面板可「用我的版本」。3. A 删 B 改 → 删除优先，B 的修改进快照。4. A 离线建 3 条 → 联网自动推 → B 拉到。5. localOnly 笔记在 B 永不出现；抓包确认零请求。6. 服务端重启（丢内存不丢库）→ 游标续传正确。

### 11.3 验收清单

- [ ] 三端 embedding 对拍全绿（6.10/附录 C）
- [ ] 离线全功能：飞行模式下可建/改/删/搜（本地检索）/看问答历史
- [ ] 冷启动 < 2s 进列表（不含端侧模型加载）
- [ ] localOnly 抓包零出网
- [ ] 深色模式无断裂；触控目标 ≥44px/44vp
- [ ] 30 天回收站自动清理（本地定时 + 启动清理）
- [ ] M3：飞行模式下端侧 AI 整理 + 问答可用（Flutter）

---

## 12. 里程碑

| 里程碑 | 内容 | 出口标准 |
|--------|------|---------|
| **M0 联调环境** | 部署 web/ 服务器；curl 跑通 4.1 登录 + #2 建笔记 + #16/#17 同步 | 三条链路 200 |
| **M1 Flutter 骨架** | 工程初始化、DB、登录、笔记 CRUD（本地+服务器直连）、列表/编辑器 | 真机 CRUD 与 Web 版行为一致 |
| **M2 同步+检索** | outbox/LWW 引擎、冲突面板、关键词+语义检索、图片上传/展示 | 11.2 矩阵 6 项全过 |
| **M3 全功能+端侧 AI** | 问答/标签/回收站/AI 模式三态/flutter_gemma/OCR | 11.3 验收全绿 |
| **H1 鸿蒙对齐 M2** | 9 章 v1 全量（云端 AI 档） | 同 11.2/11.3（去端侧 AI 项） |
| **M4/H2 发布** | 签名、合规页、商店材料 | 双平台可安装包 + 鸿蒙上架提审 |

执行顺序建议：M0 → M1 → M2 → M3 与 H1 可并行（H1 依赖 M0/M1 的契约实现经验，可直接移植 M2 已验证的状态机）→ 发布。

---

## 附录 A：联调 curl 脚本（M0 验收用）

```bash
BASE=http://localhost:3000
CK=/tmp/fi.cookies; rm -f $CK
# ① CSRF
CSRF=$(curl -s -c $CK $BASE/api/auth/csrf | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
# ② 登录（替 <店主名>/<密码> 为实际凭证）
curl -s -b $CK -c $CK -X POST $BASE/api/auth/callback/credentials \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "csrfToken=$CSRF&username=<店主名>&password=<密码>&json=true"
# ③ 会话校验（应返回 user 对象）
curl -s -b $CK $BASE/api/auth/session
# ④ 建笔记
curl -s -b $CK -X POST $BASE/api/notes -H 'Content-Type: application/json' \
  -d '{"title":"curl 测试","content":"# 正文\n移动端联调"}'
# ⑤ push 一条变更（替 NOTE_ID）
curl -s -b $CK -X POST $BASE/api/sync/push -H 'Content-Type: application/json' \
  -d '{"deviceId":"device-curl-0001","changes":[{"entity":"note","op":"upsert","data":{"id":"NOTE_ID","title":"同步改","content":"..","pinned":false,"localOnly":false,"type":"text","deletedAt":null,"updatedAt":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"}}]}'
# ⑥ pull
curl -s -b $CK "$BASE/api/sync/pull?since=0"
```

## 附录 B：品牌文案包（原样使用，禁止改写）

```text
appName            = 记不住
slogan             = 脑子寄存处
tagline            = 你记不住的，它都记得住。
emptyTitle         = 这里啥也没有。
emptyDesc          = 不过没关系，你记不住，它记得住。
searchPlaceholder  = 想找啥？尽管问，反正你也不记得。
localModeBadge     = 本地模式：脑子放自己家
cloudModeBadge     = 云端模式：脑子放别人家（可选）
autoModeBadge      = 自动模式：看谁脑子好使就用谁
organizeDoneToast  = 已帮你归类。不用谢，反正你下次也找不到。
organizeLoadingToast = 正在帮你归类…
syncToast          = 正在把脑子同步到其他设备……
trashHint          = 删掉的东西在脑子里还会留 30 天。
trashEmpty         = 回收站空空如也，干干净净。
noResultText       = 没找到相关记录，反正你也不记得
editorLocalOnlyLabel = 仅本地（不上传不同步）
uploadingImageText = 正在看图…
exampleQuestions   = ["帮我找关于发票的记录", "总结我的旅行笔记", "我记过哪些好看餐厅"]
semanticSearchHint = 语义模式：按意思找，不用记得原话。
searchModeKeyword  = 关键词
searchModeSemantic = 语义
searchModeHybrid   = 混合
syncPanelTitle     = 同步与设备
syncNowText        = 立即同步
syncOfflineLabel   = 离线模式
syncOfflineDesc    = 先记在脑子里，联网后自动同步到其他设备。
pendingBadgeText   = 待同步
reindexText        = 重建语义索引
conflictTitle      = 冲突记录
conflictKeepMine   = 用我的版本
conflictKeepServer = 用服务器版本
loginWelcome       = 私有仓库，仅服务店主一人。请出示钥匙。
loginUserLabel     = 店主名
loginPassLabel     = 钥匙（密码）
loginSubmit        = 开门
loginLoading       = 正在开门…
loginError         = 钥匙不对。别急，想想再试。
loginFoot          = 你记不住的，它都记得住。
logoutAria         = 退出登录
启动页文案          = 记不住 / 脑子寄存处 / 正在唤醒你的第二大脑……
```

## 附录 C：三端一致性对拍基准（由 Web 参考实现生成，冻结）

### C.1 FNV-1a 哈希基准（10 例）

```text
token      fnv1a(token) 无符号十进制    十六进制
你         3848247743                  0xE55F99BF
好         4165578152                  0xF849ADA8
你好       3619451238                  0xD7BC7166
体检       1526645190                  0x5AFEC1C6
发票       3668004732                  0xDAA14F7C
健康       2171145461                  0x81690CF5
note       2442791997                  0x919A0C3D
ai         1143273375                  0x4424F79F
2024       1109999801                  0x422940B9
旅行笔记   1342099936                  0x4FFED1E0
```

### C.2 向量基准

```text
embed("体检报告", weight=1) 的 tokenize 序列：
  体:1 检:1 报:1 告:1 体检:2 检报:2 报告:2
非零维（index:value，共 7 个，其余全 0）：
  [14,0.5],[29,-0.25],[32,-0.25],[34,-0.25],[198,0.5],[222,0.5],[223,0.25]

embed(多部件)：parts = [ {text:"体检报告", weight:3}, {text:"周三上午空腹抽血，注意尿酸", weight:1} ]
非零维（28 个）：
  [8,0.14142],[14,0.42426],[29,-0.21213],[32,-0.21213],[34,-0.21213],[36,0.07071],
  [66,-0.14142],[87,-0.07071],[95,-0.07071],[106,-0.14142],[120,0.14142],[135,-0.07071],
  [142,0.07071],[143,-0.14142],[173,-0.07071],[188,0.14142],[198,0.42426],[211,0.14142],
  [215,0.07071],[221,0.07071],[222,0.42426],[223,0.21213],[232,-0.07071],[235,-0.14142],
  [244,-0.07071],[247,-0.21213],[250,-0.14142],[254,0.07071]

余弦基准：
  cos(embed("周三体检报告"), embed("体检 尿酸 复查")) = 0.2774
  cos(embed("周三体检报告"), embed("午饭发票报销"))   = 0.0836
```

### C.3 对拍测试模板

```dart
test('fnv1a 与 Web 基准一致', () {
  expect(fnv1a('你'), 3848247743);
  expect(fnv1a('体检'), 1526645190);
  expect(fnv1a('2024'), 1109999801);
});
test('embed 与 Web 基准一致', () {
  final v = embedWeighted([EmbedPart('体检报告', 1)]);
  expect(v[14], 0.5);  expect(v[29], -0.25);
  expect(v[198], 0.5); expect(v[223], 0.25);
});
```

（Kotlin/Swift/ArkTS 版用同样断言；Swift 注意 UInt32 与 Double 断言精度。）

## 附录 D：契约边界与已知限制（v1 同步）

1. **tags 与 attachments 不参与 push/pull**：多端标签/附件列表暂不互通（各自通过 #1-#10 API 与 #9 上传维护）。出路：服务端扩展 SyncChange 支持 entity: 'tag' | 'attachment'（列为本仓库未来工作），契约以服务器新版本为准，客户端预留 entity 字段即可。
2. **summary/semanticKeywords 双写**：端侧 AI 生成后 push 上行会按 LWW 覆盖服务器值，属预期；多端最终一致。
3. **客户端时钟偏移**：LWW 依赖 updatedAt；设备时钟不准会影响裁决。增强方案（可选）：登录后用 `serverTime` 与本地时间差估算 offset，入 outbox 时统一加 offset。
4. **彻底删除的传播**：服务器 #5 `?permanent=1` 后 pull 下发 `note:null`；若客户端离线期间本地又改了同一条（dirty），按 5.4 跳过后由 push 结果裁决（服务器返回 applied 重建该笔记）。
5. **单用户假设**：服务器仅一个 owner；deviceId 不区分用户。未来多用户化需服务端加 userId 维度，客户端契约不变。

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2025 | 首版：基于 Web 原型 v1.2 实际契约编写；新增决策 D10-D15；三端详细设计；一致性对拍基准 |




