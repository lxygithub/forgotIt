# 记不住 · 本地 AI 记事本方案

> 项目名：记不住  
> 英文名：ForgotIt  
> Slogan：脑子寄存处  
> 副标语：你记不住的，它都记得住。  
> 目标平台：Android / iOS / PC Web  
> 技术栈：Flutter + 端侧 LLM + 多模态 VLM + OCR + 本地 RAG + 云端 API 可选 + 自建后端  
> 版本：v2.0  
> 日期：2026-09-15  

---

## 修订记录

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| v1.2 | 2026-09-15 | 初版方案 |
| v2.0 | 2026-09-15 | ① 修正模型格式矛盾（LiteRT vs GGUF）与 Web 内存预算；② 移除不存在的 `on_device_rag`，改用 flutter_gemma 内置 RAG；③ 数据模型补齐 tags / local_only / attachments.description / embeddings 版本 / 索引 / 全文检索；④ 新增第 14-18 节：产品需求、Flutter 应用架构、Prompt 规范、测试与 CI/CD、合规许可证；⑤ 确认 8 项关键决策（见第 11 节决策日志）；⑥ 路线图合并为 v1.0 全功能交付 |

---

## 1. 项目目标

**记不住（ForgotIt）** 是一款本地优先的 AI 记事本。它的口号是：**脑子寄存处**。

开发目标：

- 支持 Android、iOS、PC Web 三端，一套 Flutter 代码。
- 默认完全离线运行，不依赖云端 API。
- 支持文本、图片、截图的录入与理解。
- AI 自动整理、归类、打标签（混合标签体系，见 14.4）。
- 笔记正文原生采用 Markdown 存储，纯文本输入天然兼容。
- 支持自然语言问答检索：
  - “帮我找上次拍的那张发票”
  - “总结所有关于项目 A 的笔记”
- 图片支持 OCR 文字提取与视觉理解。
- **可选接入云端大模型 API**：本地算力不足时，用户可手动或自动切换到云端模型。
- **自建后端存储**：支持多设备同步、备份、跨端数据共享，数据存于用户自己的服务器。
- 所有数据与模型默认在本地，隐私安全；云端功能需用户显式开启。

一句话总结：

> 你记不住的，它都记得住。

---

## 2. 整体架构

采用 Local-First + Cloud-Optional + Self-Hosted Backend 混合架构：

```text
┌──────────────────────────────────────────────────────┐
│         Flutter UI（Android / iOS / Web 共享）          │
├──────────────────────────────────────────────────────┤
│      业务逻辑层（纯 Dart，100% 跨端共享）                │
│   笔记 CRUD / 意图路由 / RAG 编排 / 对话状态机 / 同步引擎  │
│   状态管理：Riverpod 3.x   路由：go_router              │
├──────────────────────────────────────────────────────┤
│      AI 能力抽象层（统一 Dart API，详见第 5.2 节）        │
│  ┌───────────┬──────────┬──────────────────────────┐  │
│  │ LLM 推理   │ 多模态 VLM│ OCR / Embedding           │  │
│  └───────────┴──────────┴──────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐ │
│  │         LLM Provider 抽象（本地 / 云端）            │ │
│  │  LocalGemmaProvider / OpenAI / Anthropic /         │ │
│  │  Gemini / DeepSeek / Qwen / Zhipu / Moonshot       │ │
│  └──────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────┤
│   推理后端（条件导入，各端最优实现）                      │
│  主力：flutter_gemma（LiteRT：.task / .litertlm）       │
│  备选：llamadart（GGUF，CPU 回退 / 小模型路径）          │
├──────────────────────────────────────────────────────┤
│   数据层（本地优先 + 自建后端同步）                       │
│  本地：drift(SQLite FTS5 trigram) + OPFS + 向量索引     │
│  云端：自建 API + PostgreSQL + pgvector + S3/MinIO      │
└──────────────────────────────────────────────────────┘
```

**核心原则**：

- 业务逻辑与 AI 编排逻辑用纯 Dart 编写，三端共享。
- 推理后端通过条件导入或运行时检测切换。
- **模型格式说明（v2.0 修正）**：主力框架 `flutter_gemma` 使用 **LiteRT 格式**（MediaPipe `.task` / LiteRT LM `.litertlm`），备选框架 `llamadart` 使用 **GGUF**。两种格式互不通用，模型仓库需按框架分发对应格式文件；业务层通过 LLM Provider 抽象屏蔽差异，UI 只感知“当前使用哪个 Provider”。
- LLM Provider 抽象层统一本地与云端调用，切换对业务层透明。
- 数据默认本地存储，自建后端仅用于同步与备份，用户可完全关闭。

---

## 3. 技术栈选型

| 层级 | 推荐方案 | Web 支持 | 说明 |
|---|---|---|---|
| LLM 推理（本地主力） | `flutter_gemma` 1.7.x | ✅ 仅 WebGPU | LiteRT 格式，多模态视觉原生支持，内置 RAG |
| LLM 推理（本地备选） | `llamadart` | ✅ WebGPU + CPU 回退 | GGUF 格式，覆盖纯文本小模型与低端设备路径 |
| 云端 API 客户端 | `dio` + 自建 Provider 抽象 | ✅ | 统一 OpenAI / Anthropic / Gemini 等接口 |
| API Key 存储 | `flutter_secure_storage` | ✅ | Android Keystore / iOS Keychain / Web 加密 |
| OCR | `flutter_paddle_ocr` | ✅ paddleocr-js | 一套 Dart API，三端统一，PP-OCRv5 中文精度好 |
| RAG 引擎 | `flutter_gemma` 内置 RAG | ✅ | EmbeddingModel + VectorStore，HNSW 索引（v2.0 决策：不再引入第三方轻量 RAG 包） |
| Web 向量存储 | wa-sqlite + OPFS | ✅ | flutter_gemma Web 端默认路径 |
| 本地数据库 | `drift`（SQLite） | ✅ Wasm | 三端统一 ORM；全文检索用 FTS5 trigram |
| 本地状态管理 | `flutter_riverpod` 3.x | ✅ | 编译安全、可测试、AsyncNotifier 适配 AI 流式状态 |
| 路由 | `go_router` | ✅ | 声明式路由，深链与 Web URL 支持 |
| Markdown 渲染 | `flutter_markdown_plus` + `markdown` | ✅ | 正文渲染预览；导出用 `markdown` 包 |
| 国际化 | `flutter_localizations` + `intl` | ✅ | 中文优先，架构预留多语言 |
| 同步引擎 | 自研 + `connectivity_plus` | ✅ | 离线队列 + 增量同步 + LWW 冲突解决 |
| 后端框架 | FastAPI（Python 3.12） | — | **v2.0 已定**（决策日志 D4），理由见 6.2 |
| 后端数据库 | PostgreSQL 16 + pgvector + pg_trgm | — | 关系数据 + 向量检索 + 中文全文检索 |
| 数据库迁移 | Alembic（后端）/ drift Migration（本地） | — | 两侧迁移策略见 6.3 与 15.4 |
| 对象存储 | MinIO / S3 | — | 图片、附件、模型文件 |
| 认证 | JWT + OAuth2 | — | 自建后端认证 |
| 部署 | Docker Compose + Caddy | — | 一键部署，自动 HTTPS |

---

## 4. 模型选型与内存预算

### 4.1 本地 LLM 主控模型

Web 端硬约束：**浏览器 Wasm 堆内存上限约 4GB**。

| 模型 | 格式 / 量化 | 大小 | 框架 | 适用场景 |
|---|---|---|---|---|
| Gemma 3n E2B（int4） | `.litertlm` / `.task` | ~3.0GB（以分发文件实测为准） | flutter_gemma | 多模态 + RAG 兼顾，**三端默认** |
| Llama 3.2 1B | GGUF Q4_K_M | ~0.8GB | llamadart | 纯文本降级路径，低内存设备兜底（**无视觉**） |
| LFM2.5-VL 450M | GGUF（量化后） | ~0.4-0.5GB | llamadart | 低端 iPhone / 小内存设备的多模态轻量路径（v2.0 补录，原 v1.2 第 7 节孤立引用） |

**关键决策与格式约束（v2.0 修正）**：

- `flutter_gemma` 只消费 LiteRT 格式；**多模态视觉必须走 `.litertlm`（Gemma 3n LiteRTLM）路径**。GGUF 生态对 Gemma 3n 目前普遍仅支持文本（如社区 GGUF 转换版标注 only text），**不能**作为视觉路径。
- Web 端 `flutter_gemma` 仅支持 WebGPU 后端，无 CPU 回退；不支持 WebGPU 的浏览器直接提示切换云端模式或降级 1B 纯文本路径。
- `llamadart` 提供 CPU 回退与小模型 GGUF 路径，作为兼容性兜底与低端设备方案。
- 本地算力不足时，可通过第 5 节切换到云端 API。

### 4.2 云端模型选型（可选）

| Provider | 推荐模型 | 多模态 | 适用场景 |
|---|---|---|---|
| OpenAI | GPT-4o / GPT-4o-mini | ✅ | 综合能力最强，多模态完善 |
| Anthropic | Claude 3.5 Sonnet / Haiku | ✅ | 长文本理解、代码、写作 |
| Google | Gemini 2.0 Flash | ✅ | 高性价比，多模态，长上下文 |
| DeepSeek | DeepSeek-V3 / R1 | ❌ | 中文强，推理强，价格低 |
| 通义千问 | Qwen-VL-Max / Qwen-Max | ✅ | 中文多模态，国内访问稳定 |
| 智谱 | GLM-4V / GLM-4-Plus | ✅ | 中文多模态，国内合规 |
| Moonshot | Kimi K2 / Moonshot-v1 | ✅ | 超长上下文，中文文档处理 |

### 4.3 多模态与 OCR

- **VLM 路径**：Gemma 3n E2B（LiteRTLM）自带视觉能力，可处理图像问答与基础 OCR。
- **专用 OCR 兜底**：`flutter_paddle_ocr` 在 Web 端通过 paddleocr-js 运行 PP-OCRv5，精确文字提取精度优于通用 VLM OCR。
- **云端多模态**：切换到 GPT-4o / Gemini 2.0 Flash 时，可直接用云端视觉能力处理复杂图像。
- **分工规则**：图片入库时“VLM 生成描述 + PaddleOCR 提取精确文本”双路并行，结果分别写入 `attachments.description` 与 `attachments.ocr_text`（见 6.3）。

### 4.4 Web 端内存预算（v2.0 重算）

默认配置（Gemma 3n E2B int4，含视觉 projector）：

| 组件 | 内存占用 |
|---|---|
| Gemma 3n E2B int4（.litertlm，含视觉） | ~3.0GB |
| RAG 引擎 + 向量索引 | ~500MB |
| OCR 运行时（paddleocr-js） | ~200MB |
| Wasm 运行时开销 | ~300MB |
| **总计** | **~4.0GB（贴近上限，高风险）** |

**结论**：默认配置在 4GB Wasm 上限内**无安全余量**，必须内置降级策略：

| 等级 | 触发条件 | 行为 |
|---|---|---|
| L0 完整版 | WebGPU 可用且 `deviceMemory` / 实测余量充足 | E2B 全功能 |
| L1 纯文本 | 内存余量 < 3.2GB 或模型加载 OOM | 降级 Llama 3.2 1B Q4_K_M（~1.8GB 总占用），图片理解转云端 |
| L2 云端 | WebGPU 不可用 或 用户选择 | 本地仅保留 Embedding + OCR，推理全部走云端 |

降级在设置页可手动指定，运行时检测到 OOM 自动建议降级。

低内存设备可降级为：

- Llama 3.2 1B Q4_K_M（~0.8GB），总占用压缩至 ~1.8GB。
- 或直接切换云端 API，本地仅保留 Embedding + OCR。
- 低端 iPhone 多模态轻量路径：LFM2.5-VL 450M（~0.4-0.5GB，llamadart）。

### 4.5 模型下载与缓存管理

- **下载**：`dio` 分块下载 + 断点续传（HTTP Range）；下载中显示进度、速度、剩余时间。
- **校验**：模型清单（manifest JSON）携带 sha256 与文件大小，下载完成后校验，失败自动重下。
- **存储**：移动端存 App 文档目录；Web 端 >2GB 用 OPFS streaming，<2GB 用 Cache API。
- **版本管理**：本地记录模型版本号；模型更新采用“下载新文件 → 校验 → 原子替换 → 清理旧文件”。
- **空间管理**：设置页展示已下载模型占用，支持删除与重下。

---

## 5. 云端大模型 API 接入方案

### 5.1 设计目标

- 本地算力不足时，可无缝切换到云端模型。
- 支持多家 Provider，用户可自由选择。
- API Key 安全存储，不泄露。
- 切换对业务层透明，UI 只感知“当前使用本地/云端”。
- 云端模式下仍保留本地 RAG 检索，仅将生成与理解交给云端。

### 5.2 Provider 抽象层

统一接口设计：

```dart
abstract class LlmProvider {
  String get id;
  String get displayName;
  bool get isLocal;
  bool get supportsVision;
  bool get supportsStreaming;

  Future<ChatResponse> chat(
    List<ChatMessage> messages, {
    ImageAttachment? image,
    Map<String, dynamic>? options,
  });

  Stream<ChatChunk> chatStream(
    List<ChatMessage> messages, {
    ImageAttachment? image,
    Map<String, dynamic>? options,
  });

  Future<List<double>> embed(String text);
}
```

实现类：

- `LocalGemmaProvider` — 封装 `flutter_gemma`（v2.0 更名，原 LocalLlamaProvider）
- `LocalLlamaProvider` — 封装 `llamadart`（低端设备/纯文本降级路径）
- `OpenAiProvider` — GPT-4o / GPT-4o-mini
- `AnthropicProvider` — Claude 3.5 Sonnet / Haiku
- `GeminiProvider` — Gemini 2.0 Flash
- `DeepSeekProvider` — DeepSeek-V3 / R1
- `QwenProvider` — 通义千问
- `ZhipuProvider` — 智谱 GLM-4V
- `MoonshotProvider` — Kimi

### 5.3 切换与降级策略

支持三种模式：

| 模式 | 行为 |
|---|---|
| **仅本地** | 完全离线，不调用任何云端 API |
| **仅云端** | 所有推理交给云端，本地仅做 RAG 检索与 OCR |
| **自动** | 优先本地；本地加载失败、内存不足、或任务复杂度超阈值时，提示切换到云端 |

**自动模式的触发条件**：

- 本地模型加载失败或 OOM（对应 4.4 的 L1/L2 降级链）。
- 当前设备可用内存低于模型需求。
- 任务类型为长文档总结、复杂推理、多图理解。
- 用户手动点击“使用云端增强”。

**按任务路由示例**：

| 任务 | 路由 |
|---|---|
| 笔记自动打标签 | 本地 |
| 简单问答检索 | 本地 |
| 长文档总结 | 云端 |
| 复杂图像理解 | 云端 |
| 隐私敏感内容 | 强制本地（`notes.local_only = true`，见 6.3） |

### 5.4 API Key 安全存储

- 使用 `flutter_secure_storage`：
  - Android：Keystore
  - iOS：Keychain
  - Web：加密存储（IndexedDB + WebCrypto）
- 可选：通过自建后端代理云端 API，客户端不直接持有 Key。
  - 优点：Key 不暴露，可统一计费、限流、审计。
  - 缺点：需要后端中转，增加部署复杂度。
- 推荐：**默认客户端直连 + Key 本地加密存储**；企业用户可选后端代理模式。

### 5.5 隐私与数据流向

- 云端模式下，笔记内容会发送到第三方 API。
- UI 必须明确提示用户当前处于云端模式（全局横幅 + 输入区角标）。
- 提供“仅发送必要片段”选项，避免全文上传。
- 隐私敏感笔记标记 `local_only` 后：**不进入任何云端请求，不参与同步**，RAG 检索仅在本地索引进行。
- 自建后端模式下，数据仅存于用户自己的服务器。

---

## 6. 自建后端存储方案

### 6.1 设计目标

- 多设备同步：Android / iOS / Web 共享笔记数据。
- 备份与恢复：防止本地数据丢失。
- 跨端检索：Web 端可检索移动端创建的笔记。
- 数据自主可控：部署在用户自己的服务器。
- 可选端到端加密：服务端只存密文。

### 6.2 后端技术栈（v2.0 已定 FastAPI）

| 层级 | 方案 | 说明 |
|---|---|---|
| Web 框架 | **FastAPI（Python 3.12）** | 决策日志 D4。选型理由：pgvector / pg_trgm / Alembic 生态成熟；Pydantic 与 OpenAPI 文档天然契合本方案 API-first 设计；后续服务端 AI 增强（embedding 兜底、批量重索引）用 Python 生态最顺。NestJS 备选记录在案，不再展开 |
| ORM / 迁移 | SQLAlchemy 2.0 + Alembic | 异步 asyncpg 驱动 |
| 数据库 | PostgreSQL 16 + pgvector + pg_trgm | 关系数据 + 向量检索 + 中文全文检索 |
| 对象存储 | MinIO（自建）或 S3（云） | 图片、附件、模型文件 |
| 缓存 | Redis（可选） | 会话、限流、任务队列 |
| 认证 | JWT + OAuth2 | 支持邮箱注册、第三方登录 |
| 反向代理 | Caddy | 自动 HTTPS |
| 部署 | Docker Compose | 一键部署，易于维护 |

### 6.3 数据模型（v2.0 扩充）

```sql
-- 用户
users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
)

-- 设备
devices (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT,
  platform TEXT,                -- android / ios / web
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
)

-- 笔记（v2.0：新增 type / summary / local_only / pinned）
notes (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'text',   -- text / image / mixed
  title TEXT,
  content TEXT,                        -- Markdown 正文；纯文本视为不含语法的 Markdown
  summary TEXT,                        -- AI 生成摘要（列表页展示）
  local_only BOOLEAN NOT NULL DEFAULT false,  -- 隐私标记：不同步、不走云端
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,              -- 软删除（回收站，30 天）
  version INT DEFAULT 1
)

-- 标签（v2.0 新增：混合标签体系）
tags (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'category'（固定类目树）/ 'free'（AI 或用户自由标签）
  parent_id UUID REFERENCES tags(id),  -- 类目树父节点，自由标签为 NULL
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name, kind)
)

-- 笔记-标签关联（v2.0 新增）
note_tags (
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                -- 'ai' / 'user'（区分 AI 打标与用户手动）
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (note_id, tag_id)
)

-- 附件（v2.0：新增 description）
attachments (
  id UUID PRIMARY KEY,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  file_path TEXT,                      -- 对象存储 key
  thumb_path TEXT,                     -- 缩略图 key
  mime_type TEXT,
  size BIGINT,
  width INT,
  height INT,
  description TEXT,                    -- VLM 图像描述（入向量索引，跨模态检索用）
  ocr_text TEXT,                       -- PaddleOCR 提取文本（入向量索引）
  created_at TIMESTAMPTZ DEFAULT now()
)

-- 向量（v2.0：新增 model_name / model_version）
embeddings (
  id UUID PRIMARY KEY,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  attachment_id UUID REFERENCES attachments(id) ON DELETE CASCADE,
  chunk_text TEXT,                     -- 分块原文
  vector VECTOR(768),
  model_name TEXT NOT NULL,            -- 如 'gemma-embedding'
  model_version TEXT NOT NULL,         -- 换模型/换版本时可增量重建
  created_at TIMESTAMPTZ DEFAULT now()
)

-- 同步日志
sync_log (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  entity_type TEXT,                    -- note / tag / attachment
  entity_id UUID,
  operation TEXT,                      -- create / update / delete
  timestamp TIMESTAMPTZ,
  version INT
)

-- 关键索引（v2.0 新增）
CREATE INDEX idx_notes_user_updated ON notes(user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_local_only ON notes(user_id) WHERE local_only = true;
CREATE INDEX idx_tags_user_kind ON tags(user_id, kind);
CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);
CREATE INDEX idx_attachments_note ON attachments(note_id);
CREATE INDEX idx_sync_log_user_ts ON sync_log(user_id, timestamp DESC);
CREATE INDEX idx_embeddings_hnsw ON embeddings
  USING hnsw (vector vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_embeddings_note ON embeddings(note_id);

-- 中文全文检索（v2.0 新增）
-- 方案：pg_trgm 三元组索引，CJK 无分词依赖、即装即用；
-- 需要更高召回时可选 zhparser / pg_jieba 扩展（部署文档说明启用方法）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_notes_title_trgm ON notes USING gin (title gin_trgm_ops);
CREATE INDEX idx_notes_content_trgm ON notes USING gin (content gin_trgm_ops);
```

**本地端（drift/SQLite）对应表结构**保持同构：`notes / tags / note_tags / attachments / embeddings / tombstones（墓碑）/ sync_queue（离线队列）/ search_index（FTS5 trigram 虚表）`，字段与后端一一映射，详见 14.2。

### 6.4 API 设计（v2.0 扩充）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/auth/register` | POST | 注册 |
| `/auth/login` | POST | 登录，返回 JWT |
| `/auth/refresh` | POST | 刷新 Token |
| `/notes` | GET | 获取笔记列表（分页、过滤：tag/type/pinned/时间范围） |
| `/notes` | POST | 创建笔记 |
| `/notes/{id}` | GET | 笔记详情（含附件、标签） |
| `/notes/{id}` | PUT | 更新笔记 |
| `/notes/{id}` | DELETE | 软删除（进回收站） |
| `/notes/{id}/restore` | POST | 从回收站恢复 |
| `/notes/{id}/attachments` | POST | 上传附件（multipart，白名单校验 mime） |
| `/notes/{id}/tags` | PUT | 整体替换笔记标签（含 source 标记） |
| `/tags` | GET / POST | 标签列表 / 新建（类目或自由标签） |
| `/tags/{id}` | PUT / DELETE | 改名 / 删除（类目树支持 parent_id 移动） |
| `/search/keyword` | POST | 关键词检索（pg_trgm，标题 + 正文 + ocr_text） |
| `/search/semantic` | POST | 语义检索（pgvector） |
| `/ask` | POST | RAG 问答（服务端检索 + 云端 LLM 生成，可选） |
| `/export/markdown` | POST | 批量导出全部笔记为 `.zip` |
| `/sync/push` | POST | 推送本地变更（批量 upsert，携带 version） |
| `/sync/pull` | POST | 拉取云端变更（`since` 游标增量） |

**`/sync/push` 请求体骨架**：

```json
{
  "device_id": "uuid",
  "changes": [
    { "entity": "note", "op": "update", "data": { "...": "..." }, "base_version": 3, "new_version": 4, "updated_at": "..." }
  ]
}
```

**`/sync/pull` 响应骨架**：按 `sync_log` 返回 `since` 之后的变更流水 + 最新实体快照。

### 6.5 同步策略（v2.0 确认 LWW）

- **离线优先**：本地写入 → 加入 `sync_queue` → 联网后自动推送。
- **增量同步**：基于 `updated_at` 和 `version` 字段。
- **冲突解决**：**Last-Write-Wins（已确认，决策日志 D6）**；服务端以 `updated_at` 时间戳为准，落败方变更不丢弃——保留为该笔记的一次版本快照，供用户在“冲突记录”中查看（防数据丢失底线）。
- **CRDT（automerge/yjs 的 Dart 绑定）**：列为远期可选项，v1.x 不实现。
- **删除**：软删除 + 墓碑记录（本地 `tombstones` 表 + 服务端 `deleted_at`），确保多端一致；回收站 30 天后物理清理。
- **`local_only` 笔记**：同步引擎入队前过滤，永不出本地。
- **同步触发**：
  - 应用启动时。
  - 网络恢复时（`connectivity_plus`）。
  - 用户手动下拉刷新。
  - 定时后台同步（移动端可选）。

### 6.6 安全与加密

- 强制 HTTPS。
- JWT 短期有效（15 分钟）+ Refresh Token（30 天，可吊销）。
- 可选端到端加密：
  - 客户端加密笔记内容，服务端只存密文。
  - 密钥由用户主密码派生（Argon2id）。
  - 服务端无法解密，隐私最强。
  - 注意：E2E 加密开启后，服务端全文检索与语义检索失效，检索退回客户端本地执行。
- API 限流：Redis + 滑动窗口（登录 5 次/分钟，API 120 次/分钟）。
- 上传校验：mime 白名单（png/jpeg/webp/pdf）、单文件 ≤ 20MB、用户总配额（默认 5GB）。
- 审计日志：记录登录、批量导出、删除等关键操作。

### 6.7 部署建议

Docker Compose 示例服务：

```yaml
services:
  api:
    build: ./backend
    ports:
      - "8000:8000"
    depends_on:
      - db
      - minio
  db:
    image: pgvector/pgvector:pg16
    volumes:
      - pgdata:/var/lib/postgresql/data
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes:
      - miniodata:/data
  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
```

- Caddy 自动申请 Let's Encrypt 证书。
- 可选：Tailscale / WireGuard 内网访问，进一步隔离公网。

---

## 7. 各平台集成要点

### Android

- 推理后端：`flutter_gemma` + LiteRT（GPU 委托）；备选 `llamadart`（GGUF + CPU 回退）。
- 模型：Gemma 3n E2B int4（8GB 设备余量约 3-4GB）；性能充裕时可上 E4B。
- OCR：`flutter_paddle_ocr` 的 Android 后端（Paddle Lite + JNI）。
- 云端 API：`dio` + Provider 抽象，Key 存于 Keystore。
- 同步：`connectivity_plus` + 后台任务。
- 构建：锁定 NDK r25c。

### iOS

- 推理后端：`flutter_gemma` + LiteRT（Core ML / Metal 委托）。
- iPhone 15 Pro 上约 15 tok/s（E2B int4，实测为准）。
- **低配 iPhone（v2.0 修正）**：LFM2.5-VL 450M 为 GGUF 格式，`flutter_gemma` 不支持该架构，此路径必须走 **`llamadart` + GGUF**（~0.4-0.5GB，多模态轻量）。
- OCR：`flutter_paddle_ocr` iOS 后端，Paddle Lite 仅 arm64-device-only，必须真机测试。
- 云端 API：Key 存于 Keychain。
- 同步：Background Fetch + 手动刷新。

### Web

- 推理后端：`flutter_gemma` WebGPU 路径（仅 WebGPU，无 CPU 回退）。
- 模型：Gemma 3n E2B int4，>2GB 模型需 OPFS streaming；按 4.4 的 L0/L1/L2 降级链执行。
- OCR：`flutter_paddle_ocr` Web 后端（paddleocr-js + ONNX Runtime Web）。
- 向量存储：wa-sqlite + OPFS（flutter_gemma Web 默认路径）。
- 云端 API：Key 加密存于 IndexedDB，或走后端代理。
- 同步：Service Worker + 后台同步（可选）。
- 跨域隔离：`COOP: same-origin` + `COEP: require-corp`（见 web/index.html）。

---

## 8. RAG 与图文混合检索（v2.0 更新）

**引擎决策（决策日志 D8）**：统一使用 `flutter_gemma` 内置 RAG（EmbeddingModel + VectorStore + HNSW），移除 v1.2 中的 `on_device_rag` 引用（该包在 pub.dev 不存在）；后端 pgvector 作为跨端/大规模补充。

### Embedding 选型

- 模型：Gemma Embedding（768 维，多语言，中文友好），随 `flutter_gemma` 的 `EmbeddingModel` 加载。
- **版本化**：每次生成向量记录 `model_name + model_version`；更换 embedding 模型或版本后，启动时检测不一致 → 提示用户后台增量重索引（逐笔记重建，不清空旧数据直到重建完成）。

### 文本笔记

1. 分块（见下）→ `EmbeddingModel` 生成 768 维向量。
2. 存入 VectorStore（本地）/ pgvector（同步后）。
3. 检索时 HNSW 近似最近邻搜索，top-k = 5。

### 图片 / 截图

1. VLM 生成图像描述（`attachments.description`）+ PaddleOCR 提取文本（`attachments.ocr_text`）。
2. 描述与 OCR 文本分别分块入同一向量索引 → 跨模态检索（“找那张发票”能命中图片）。
3. 附件原图可上传到自建后端 MinIO，多端共享。

### 分块策略

| 参数 | 值 | 说明 |
|---|---|---|
| chunk size | ~512 tokens | 按 Markdown 标题/段落边界优先切分 |
| overlap | 64 tokens | 保证边界语义连续 |
| 最小块 | ≥ 50 tokens | 过短块并入相邻块 |
| 中文注意 | 中文字符≈1 token/字（Gemma 分词器），按实测校准 | 避免按英文经验值切分 |

### 混合检索与排序

- **双路检索**：向量语义检索 + 关键词检索（本地 FTS5 trigram / 服务端 pg_trgm）。
- **合并**：RRF（Reciprocal Rank Fusion，k=60）合并两路结果；v1.x 不做 rerank 模型，列为后续优化。
- **问答引用**：RAG 上下文注入带来源编号 [1][2]…，答案必须标注引用笔记，答不出明确说“没找到”。

### 云端增强检索

- 自建后端 pgvector 支持大规模向量检索。
- Web 端可直接查询后端语义检索接口，无需本地加载 Embedding 模型（L2 模式）。
- 本地与云端索引通过同步引擎保持一致。

---

## 9. 关键配置与坑点

| 问题 | 解决方案 |
|---|---|
| Web 端跨域隔离 | 多线程 Wasm 需 `COOP: same-origin` + `COEP: require-corp` |
| Web 端大模型加载 | >2GB 用 OPFS streaming，<2GB 用 Cache API |
| Web 端内存贴上限 | 按 4.4 L0→L1→L2 降级链，加载前检测余量 |
| WebGPU 要求 | Chrome/Edge ≥ 113，Safari 26+；不满足则走云端模式提示 |
| Gemma 3n 的 GGUF 无视觉 | 视觉必须走 LiteRTLM 路径；GGUF 仅作纯文本降级 |
| 换 embedding 模型 | embeddings 表记录 model_version，后台增量重索引 |
| iOS 模拟器 OCR | Paddle Lite 仅 arm64-device-only，必须真机测试 |
| LFM2.5-VL 只能走 GGUF | llamadart 路径，flutter_gemma 不支持该架构 |
| Android NDK 冲突 | 锁定 NDK r25c |
| 模型加载内存峰值 | 分块加载，512MB 数据块预加载 |
| 中文全文检索 | 客户端 FTS5 trigram；服务端 pg_trgm 起步，可选 zhparser/pg_jieba 增强 |
| 云端 API Key 泄露 | `flutter_secure_storage` + 可选后端代理 |
| 同步冲突 | LWW（已定）+ 冲突快照兜底；CRDT 远期可选 |
| E2E 加密与服务端检索互斥 | 开启 E2E 后检索退回客户端 |
| 自建后端部署 | Docker Compose + Caddy 自动 HTTPS |
| 模型许可证 | Gemma / Llama 使用条款约束分发，见第 18 节 |

---

## 10. 分阶段实施路线（v2.0 调整：v1.0 全功能一起交付）

依据决策日志 D3，文本、图片、OCR、标签、RAG 问答**不分期**，合并为 v1.0 交付；开发顺序保留，里程碑合并：

### Phase 1 — 全功能核心（v1.0，4-5 周）

- Flutter 项目初始化（Riverpod + go_router + drift，工程结构见第 15 节）。
- 笔记 CRUD + Markdown 编辑/预览 + 图片附件 + 回收站。
- `flutter_gemma` 跑通 Gemma 3n E2B：文本推理 + 图片理解。
- `flutter_paddle_ocr` 接入：图片入库即 OCR。
- AI 自动打标签（混合体系）+ AI 摘要。
- 内置 RAG：分块 → Embedding → 向量索引 → 问答引用。
- 关键词 + 语义双路搜索。
- 云端 Provider 接入与手动切换（OpenAI / Gemini / DeepSeek 优先）。
- **v1.0 验收标准**：三端可安装；断网状态完成“拍照 → OCR → 自动标签 → 自然语言找到该图”；模型加载/降级链可观测。

### Phase 2 — 自建后端与同步（v1.1，3-4 周）

- FastAPI + PostgreSQL + pgvector + MinIO 搭建（第 6 节）。
- 用户认证、笔记/标签 CRUD、附件上传、关键词 + 语义检索 API。
- 离线队列 + 增量同步 + LWW + 冲突快照。
- 可选端到端加密。

### Phase 3 — 打磨与兼容（v1.2，2 周）

- WebGPU 不可用时的降级提示与引导。
- 模型下载管理（断点续传/校验/清理）体验完善。
- 内存剖析，确保 8GB 设备 Web 端不崩溃。
- 多设备同步边界场景测试（见 17.2）。

---

## 11. 关键决策（v2.0 决策日志）

| # | 决策项 | 结论 | 理由 / 备注 |
|---|---|---|---|
| D1 | 主力推理框架 | **flutter_gemma** | 多模态与内置 RAG 最完整；后续不理想可经 Provider 抽象层整体切换（切换成本已被架构隔离） |
| D2 | 编辑器形态 | **纯文本 + Markdown 都支持** | 正文统一 Markdown 存储，纯文本输入天然兼容；渲染用 flutter_markdown_plus |
| D3 | MVP 范围 | **全功能一起做** | 文本/图片/OCR/标签/RAG 并入 v1.0，见第 10 节 Phase 1 |
| D4 | 后端语言 | **FastAPI（授权代决）** | pgvector/Alembic/OpenAPI 生态契合，见 6.2 |
| D5 | 标签体系 | **混合**：固定类目树 + 自由标签 | `tags.kind` 区分；AI 打标带 `source='ai'`，用户可改，见 14.4 |
| D6 | 同步冲突 | **Last-Write-Wins** | 落败方保留冲突快照防丢数据；CRDT 远期可选 |
| D7 | 文档组织 | **扩展本文档** | v1.2 → v2.0，新增第 14-18 节 |
| D8 | 轻量 RAG | **flutter_gemma 内置** | 移除不存在的 `on_device_rag` 引用 |
| D9 | i18n | 中文优先，架构预留 | intl + flutter_localizations，文案集中管理 |

其余结论与 v1.2 一致：

- **OCR 策略**：VLM 处理通用图像理解，PaddleOCR 兜底精确文字提取。
- **云端 API 策略**：默认客户端直连 + Key 本地加密；企业用户可选后端代理。
- **隐私策略**：默认全本地；云端模式明确提示；敏感笔记 `local_only` 强制本地；可选端到端加密。

---

## 12. Markdown 支持（编辑 + 导出）

- **编辑**：正文默认 Markdown；编辑器支持源码模式与渲染预览切换（`flutter_markdown_plus`）。
- **导出单篇**：`markdown` 包将结构化笔记转为 Markdown 字符串；`path_provider` 获取本地路径；`share_plus` 分享；Web 端 `universal_html` 触发浏览器下载。
- **批量导出**：自建后端提供 `/export/markdown` 接口，打包全部笔记为 `.zip`。

示例依赖：

```yaml
dependencies:
  markdown: ^7.3.0
  flutter_markdown_plus: ^1.0.3
  path_provider: ^2.1.5
  share_plus: ^10.1.4
```

---

## 13. 品牌文案

**项目名**：记不住  
**英文名**：ForgotIt  
**Slogan**：脑子寄存处  
**副标语**：你记不住的，它都记得住。

**启动页**
> 记不住  
> 脑子寄存处  
> 正在唤醒你的第二大脑……

**空状态**
> 这里啥也没有。  
> 不过没关系，你记不住，它记得住。

**搜索框**
> 想找啥？尽管问，反正你也不记得。

**设置页**
> 本地模式：脑子放自己家  
> 云端模式：脑子放别人家（可选）  
> 自动模式：看谁脑子好使就用谁

**同步提示**
> 正在把脑子同步到其他设备……

**AI 整理完成**
> 已帮你归类。不用谢，反正你下次也找不到。

---

## 14. 产品需求与功能规格（v2.0 新增）

### 14.1 核心用户故事

| # | 用户故事 | 验收要点 |
|---|---|---|
| U1 | 作为用户，我能快速新建一条笔记，不用担心格式 | 新建 < 2s；Markdown/纯文本直接输入 |
| U2 | 作为用户，我拍张照片存进来，之后能靠文字找到它 | OCR + VLM 描述入索引；搜“发票”能命中 |
| U3 | 作为用户，我希望 AI 自动帮我归类打标签 | 保存后自动生成类目 + 标签，可手动改 |
| U4 | 作为用户，我能用大白话问它问题并得到带出处的答案 | 回答引用来源笔记；没找到就明说 |
| U5 | 作为用户，我的隐私笔记绝不上传 | `local_only` 笔记无任何网络请求，同步过滤 |
| U6 | 作为用户，换设备后笔记还在 | 自建后端同步；LWW 合并 |
| U7 | 作为用户，算力不够时我能用云端增强 | 手动/自动切换，全局状态提示 |

### 14.2 本地数据结构（drift/SQLite）

```text
notes(id, type, title, content, summary, local_only, pinned,
      created_at, updated_at, deleted_at, version, dirty)
tags(id, name, kind, parent_id, color, created_at)
note_tags(note_id, tag_id, source)
attachments(id, note_id, local_path, thumb_path, mime_type, size,
            width, height, description, ocr_text, synced)
embeddings(id, note_id, attachment_id, chunk_text, vector(jsonb/blob),
           model_name, model_version)
tombstones(entity_type, entity_id, deleted_at)        -- 同步墓碑
sync_queue(id, entity_type, entity_id, op, payload, created_at, retry)
search_index(note_id, title, content, ocr_text)        -- FTS5 trigram 虚表
settings(key, value)                                   -- Provider 配置、模式、模型版本等
```

- `dirty` 标记未同步变更，入 `sync_queue`。
- 迁移：drift `schemaVersion` 递增 + `MigrationStrategy`（见 15.4）。

### 14.3 编辑器规格

- 默认 Markdown 源码模式，顶栏一键切换“源码 / 预览”。
- 图片：相册选取 / 拍照 / 剪贴板粘贴，插入即上传本地并后台 OCR + VLM。
- 自动保存：停顿 2s 或退出页面时落库；显示“已保存/待同步”状态。
- 列表页：标题 + 摘要（AI 生成）+ 标签胶囊 + 缩略图；置顶、左滑删除（进回收站）。

### 14.4 混合标签体系（决策 D5）

- **固定类目树**（默认内置，用户可增改）：
  - 生活 / 工作 / 学习 / 财务票据 / 健康 / 旅行 / 灵感速记 / 人际 / 代码技术
- **自由标签**：AI 每篇生成 3-6 个；用户可增删改。
- **规则**：每篇笔记 ≤ 1 个类目 + ≤ 6 个自由标签；AI 打标 `source='ai'`，用户手动改后标记 `source='user'`，后续 AI 重打不覆盖用户手改的标签。
- 标签页支持按类目浏览、按自由标签聚合筛选。

### 14.5 回收站

- 删除 → `deleted_at` 软删除；回收站保留 **30 天**，到期物理清理（含附件与向量）。
- 支持“恢复”与“彻底删除”；同步时墓碑传播。

### 14.6 搜索与问答 UX

- 搜索页双 Tab：“关键词”（FTS5，毫秒级）/ “语义问答”（RAG）。
- 问答页：流式输出 + 引用来源卡片（点击跳转笔记）+ “在云端重答”按钮。
- 空结果文案见第 13 节品牌文案。

### 14.7 隐私控制

- 笔记详情页“仅本地”开关（`local_only`）。
- 云端模式全局横幅 + 每次云端请求前 toast 告知。
- 设置页展示当前模式（对应品牌文案三条）。

---

## 15. Flutter 应用架构与工程规范（v2.0 新增）

### 15.1 状态管理与分层

- **Riverpod 3.x**：编译安全、无 BuildContext 侵入、`AsyncNotifier` 天然契合“模型加载中/就绪/降级”等异步状态。
- 分层：UI（Widget）→ Controller（Notifier）→ Service（业务）→ Repository（drift/网络）→ Provider（AI 抽象）。

### 15.2 目录结构（feature-first）

```text
lib/
  main.dart
  app/                 # 应用入口、go_router 路由表、主题、全局 Provider
  core/
    db/                # drift 表、DAO、迁移
    models/            # 实体与 DTO（freezed）
    ai/
      providers/       # LocalGemmaProvider / LocalLlamaProvider / 各云端 Provider
      prompts/         # Prompt 模板（第 16 节）
      router.dart      # 按任务路由本地/云端（5.3）
    rag/               # 分块、检索编排、RRF 合并
    sync/              # 离线队列、LWW 合并、墓碑
    utils/
  features/
    notes/             # 列表、编辑器、详情、回收站
    capture/           # 拍照/选图/粘贴入口
    search/            # 关键词 + 问答页
    tags/
    settings/          # 模式、Provider、模型下载管理
  l10n/                # intl 文案
```

### 15.3 代码生成与依赖

- `freezed` + `json_serializable`：实体与 API DTO。
- `drift_dev`：数据库代码生成。
- `riverpod_generator`：Provider 代码生成。
- 约束：`core/ai/providers` 之外的业务代码禁止直接 import 具体推理框架。

### 15.4 数据库迁移策略

- drift：每次 schema 变更 `schemaVersion += 1`，`MigrationStrategy.onUpgrade` 按 stepMigrator 编写；导出 schema 快照进版本库。
- 后端 Alembic：迁移文件随 PR 提交，禁止手改生产库。
- embeddings 重建：模型版本变更走 8 节的重索引流程，不属于 schema 迁移。

---

## 16. Prompt 设计规范（v2.0 新增）

所有 Prompt 模板集中存放在 `core/ai/prompts/`，支持热更新（远程配置可选）。

### 16.1 自动打标签（本地优先）

- 输入：笔记标题 + 正文前 1500 tokens（+ 图片描述如有）。
- 输出约束：严格 JSON：`{"category": "财务票据", "tags": ["发票", "报销"]}`。
- 约束注入：类目必须取自固定类目列表（枚举给模型）；自由标签 3-6 个、≤ 8 字。
- 参数：temperature 0.3；JSON 解析失败重试 1 次（附格式错误信息），仍失败则正则兜底提取，最终失败静默跳过并记日志。

### 16.2 摘要

- 输入：正文前 2000 tokens；输出：≤ 50 字一句话摘要，无标点开头结尾修饰。

### 16.3 RAG 问答

```text
你是“记不住”的检索助手。仅依据下方资料回答用户问题。
规则：
1. 每个论断后标注来源编号，如 [1]。
2. 资料不足时，回答“没找到相关记录”，不得编造。
3. 用中文回答，简洁分点。

[资料]
[1] （笔记标题，日期）chunk 内容…
[2] …
```

- 上下文预算：检索 top-5 分块 ≈ 3000 tokens + 问题，Gemma 3n 的 32K 上下文内安全。
- 云端重答：同一 Prompt 换 Provider，用户显式触发。

### 16.4 图片理解（入库时）

- 输出 JSON：`{"description": "一句话描述", "objects": [...], "text_hint": "图中可见文字主题"}`。
- 精确文字一律交给 PaddleOCR，Prompt 中要求 VLM 不逐字抄写文本。

### 16.5 评估

- 每类 Prompt 维护 10-20 条标注样例（见 17.3），改 Prompt 必须跑回归。

---

## 17. 测试、CI/CD 与可观测性（v2.0 新增）

### 17.1 测试策略

| 层 | 手段 |
|---|---|
| 业务逻辑 | 纯 Dart 单元测试：LWW 合并、分块、RRF、标签约束、回收站清理 |
| AI 抽象层 | `LlmProvider` 接口 mock：路由、降级链、local_only 过滤 |
| 数据层 | drift 内存库测试：CRUD、迁移升级用例、FTS5 查询 |
| 模型回归 | 16.5 的 Prompt 样例集 + JSON Schema 校验；本地小模型跑 CI（1B GGUF，CPU 可跑） |
| Widget | 关键页面 golden/组件测试（编辑器、问答流式） |
| 同步 | 冲突矩阵用例：同改标题/内容/标签、删改并发、`local_only` 变更 |

### 17.2 同步边界场景（清单）

- 双端同时改同一笔记（LWW 落败快照可查）。
- 一端删除、另一端编辑（删除优先，编辑内容进冲突快照）。
- `local_only` 打开后该笔记在云端已有旧版本：提示用户选择保留云端版本或彻底移除。
- 离线队列重试：指数退避，最大 5 次后转手动。

### 17.3 CI/CD

- GitHub Actions：
  - PR：`flutter analyze` + `dart format --set-exit-if-changed` + 单元测试 + drift 迁移测试。
  - main：增加 Web 构建冒烟（`flutter build web`）+ 后端 `pytest` + Alembic 校验。
- 后端镜像：Compose build，tag 跟随 git tag。
- 移动端发版：手动触发 fastlane（v1.x 可延后）。

### 17.4 可观测性（隐私优先）

- 本地日志：`logger` 分级 + 环形缓冲（最近 500 条），设置页可导出。
- 崩溃上报：**默认关闭，opt-in**（Sentry self-host 可选，与自建后端同机部署）。
- 上报内容白名单：无笔记内容、无 API Key；仅堆栈、设备型号、内存水位。

---

## 18. 合规与许可证（v2.0 新增）

| 组件 | 许可证 | 关键约束 | 应对 |
|---|---|---|---|
| Gemma 3n / Gemma Embedding | Gemma Terms of Use | 允许商用；禁止特定用途；需在“关于”页展示模型归属与许可链接 | 设置 → 关于：模型与许可声明 |
| Llama 3.2 | Llama Community License | 月活 > 7 亿需单独授权；遵守可接受使用政策 | 关于页声明；一般规模无影响 |
| LFM2.5-VL | Liquid AI 许可（随模型确认） | 商用条款以模型仓库为准 | 下载页展示对应许可 |
| PP-OCR（PaddleOCR 模型） | Apache-2.0 | 宽松 | 保留版权声明 |
| flutter_gemma / llamadart 等依赖 | 多为 MIT/Apache-2.0 | — | pubspec 审计 + 关于页第三方清单 |
| 应用隐私 | 各应用商店政策 | 数据收集声明 | 隐私政策页：默认不收集；云端模式数据流向说明 |

---

## 19. 后续可补充内容

- 后端 OpenAPI 完整规范（FastAPI 自动生成为准，补充 `/sync` 字段级定义）
- 端到端加密密钥派生与轮换方案
- RAG 检索参数实测调优（top-k、RRF k、分块边界）
- Prompt 样例集与回归基线数据
- 移动端 fastlane 发版流水线
- 桌面壳（macOS/Windows/Linux，flutter_gemma 已支持 Desktop 的 .litertlm）可行性评估
- Widget 快捷入口 / 系统分享菜单接入

---

## 20. 结论

**记不住（ForgotIt）** 以 Flutter 为统一 UI 与业务层，以 `flutter_gemma`（LiteRT 格式）为端侧推理核心（多模态 + 内置 RAG），以 `llamadart`（GGUF）为低端设备与纯文本降级路径，以 `flutter_paddle_ocr` 为 OCR 兜底，覆盖 Android、iOS、PC Web 三端。

通过 **LLM Provider 抽象层**，本地算力不足时可无缝切换到云端大模型 API，兼顾离线隐私与云端能力；主力框架若不理想，可经抽象层整体替换（决策 D1）。

通过 **自建后端**（FastAPI + PostgreSQL + pgvector/pg_trgm + MinIO），实现多设备同步（LWW）、备份与跨端检索，数据完全自主可控。

Web 端受浏览器内存限制，按 4.4 节 L0→L1→L2 降级链执行；移动端启用 GPU 加速获得更好推理速度。

产品、数据、Prompt、测试与合规规范见第 14-18 节。整体技术栈可行性已验证，按第 10 节路线执行：**v1.0 全功能一起交付**。

> 脑子寄存处，正式营业。
