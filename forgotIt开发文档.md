# 记不住 · 本地 AI 记事本方案

> 项目名：记不住  
> 英文名：ForgotIt  
> Slogan：脑子寄存处  
> 副标语：你记不住的，它都记得住。  
> 目标平台：Android / iOS / PC Web  
> 技术栈：Flutter + 端侧 LLM + 多模态 VLM + OCR + 本地 RAG + 云端 API 可选 + 自建后端  
> 版本：v1.2  
> 日期：2026-09-15

---

## 1. 项目目标

**记不住（ForgotIt）** 是一款本地优先的 AI 记事本。它的口号是：**脑子寄存处**。

开发目标：

- 支持 Android、iOS、PC Web 三端，一套 Flutter 代码。
- 默认完全离线运行，不依赖云端 API。
- 支持文本、图片、截图的录入与理解。
- AI 自动整理、归类、打标签。
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
├──────────────────────────────────────────────────────┤
│      AI 能力抽象层（统一 Dart API）                      │
│  ┌───────────┬──────────┬──────────────────────────┐  │
│  │ LLM 推理   │ 多模态 VLM│ OCR / Embedding           │  │
│  └───────────┴──────────┴──────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐ │
│  │         LLM Provider 抽象（本地 / 云端）            │ │
│  │  LocalLlama / OpenAI / Anthropic / Gemini /        │ │
│  │  DeepSeek / Qwen / Zhipu / Moonshot                │ │
│  └──────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────┤
│   推理后端（条件导入，各端最优实现）                      │
│  Android/iOS: llama.cpp (Metal/Vulkan)                 │
│  Web: wllama (Wasm SIMD / WebGPU)                      │
├──────────────────────────────────────────────────────┤
│   数据层（本地优先 + 自建后端同步）                       │
│  本地：SQLite / OPFS + HNSW 向量索引                    │
│  云端：自建 API + PostgreSQL + pgvector + S3/MinIO      │
└──────────────────────────────────────────────────────┘
```

**核心原则**：

- 业务逻辑与 AI 编排逻辑用纯 Dart 编写，三端共享。
- 推理后端通过条件导入或运行时检测切换。
- 三端共享同一套 GGUF 模型文件。
- LLM Provider 抽象层统一本地与云端调用，切换对业务层透明。
- 数据默认本地存储，自建后端仅用于同步与备份，用户可完全关闭。

---

## 3. 技术栈选型

| 层级 | 推荐方案 | Web 支持 | 说明 |
|---|---|---|---|
| LLM 推理（本地主力） | `flutter_gemma` | ✅ WebGPU 必需 | 多模态视觉原生支持，内置 RAG |
| LLM 推理（本地备选） | `llamadart` | ✅ WebGPU + CPU 回退 | 覆盖 GGUF 与 `.litertlm` 双格式 |
| 云端 API 客户端 | `dio` + 自建 Provider 抽象 | ✅ | 统一 OpenAI / Anthropic / Gemini 等接口 |
| API Key 存储 | `flutter_secure_storage` | ✅ | Android Keystore / iOS Keychain / Web 加密 |
| OCR | `flutter_paddle_ocr` | ✅ paddleocr-js | 一套 Dart API，三端统一 |
| RAG 引擎 | `flutter_gemma` 内置 RAG | ✅ | HNSW 索引 + Web 向量存储 |
| 轻量 RAG 备选 | `on_device_rag` | ✅ | 纯 Dart 零依赖，内存内余弦相似度 |
| Web 向量存储 | wa-sqlite + OPFS | ✅ | 比 IndexedDB 快 3-4 倍 |
| 本地数据库 | `drift`（SQLite） | ✅ Wasm | 三端统一 ORM |
| 同步引擎 | 自研 + `connectivity_plus` | ✅ | 离线队列 + 增量同步 |
| 后端框架 | FastAPI / NestJS | — | 自建后端，见第 6 节 |
| 后端数据库 | PostgreSQL + pgvector | — | 关系数据 + 向量检索 |
| 对象存储 | MinIO / S3 | — | 图片、附件、模型文件 |
| 认证 | JWT + OAuth2 | — | 自建后端认证 |
| 部署 | Docker Compose + Caddy | — | 一键部署，自动 HTTPS |

---

## 4. 模型选型与内存预算

### 4.1 本地 LLM 主控模型

Web 端硬约束：**浏览器 Wasm 堆内存上限约 4GB**。

| 模型 | 量化 | 大小 | 适用场景 |
|---|---|---|---|
| Gemma 3n E2B | Q2_K | ~1.89GB | 多模态 + RAG 兼顾，Web 首选 |
| Llama 3.2 1B | Q4_K_M | ~0.8GB | 纯文本，低内存设备降级 |

**关键决策**：

- Web 端必须启用 WebGPU。
- `flutter_gemma` 在 Web 端仅支持 GPU 后端，无 CPU 回退。
- `llamadart` 提供 CPU 回退，但速度显著下降，仅作兼容性兜底。
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

- **VLM 路径**：Gemma 3n E2B 自带视觉能力，可处理图像问答与基础 OCR。
- **专用 OCR 兜底**：`flutter_paddle_ocr` 在 Web 端通过 paddleocr-js 运行 PP-OCRv5，精度优于通用 VLM OCR。
- **云端多模态**：切换到 GPT-4o / Gemini 2.0 Flash 时，可直接用云端视觉能力处理复杂图像。

### 4.4 Web 端内存预算

| 组件 | 内存占用 |
|---|---|
| Gemma 3n E2B Q2_K（GGUF） | ~1.9GB |
| VLM projector（如使用） | ~300MB |
| RAG 引擎 + 向量索引 | ~500MB |
| OCR 运行时（paddleocr-js） | ~200MB |
| **总计** | **~2.9GB** |

在 4GB Wasm 上限内留有约 1GB 余量。

低内存设备可降级为：

- Llama 3.2 1B Q4_K_M（~0.8GB）
- 总占用压缩至 ~1.8GB。
- 或直接切换云端 API，本地仅保留 Embedding + OCR。

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

- `LocalLlamaProvider` — 封装 `flutter_gemma` / `llamadart`
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

- 本地模型加载失败或 OOM。
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
| 隐私敏感内容 | 强制本地 |

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
- UI 必须明确提示用户当前处于云端模式。
- 提供“仅发送必要片段”选项，避免全文上传。
- 隐私敏感笔记可标记为“仅本地”，强制不走云端。
- 自建后端模式下，数据仅存于用户自己的服务器。

---

## 6. 自建后端存储方案

### 6.1 设计目标

- 多设备同步：Android / iOS / Web 共享笔记数据。
- 备份与恢复：防止本地数据丢失。
- 跨端检索：Web 端可检索移动端创建的笔记。
- 数据自主可控：部署在用户自己的服务器。
- 可选端到端加密：服务端只存密文。

### 6.2 后端技术栈

| 层级 | 推荐方案 | 说明 |
|---|---|---|
| Web 框架 | FastAPI（Python）或 NestJS（Node.js） | 异步、类型友好、生态成熟 |
| 数据库 | PostgreSQL 16 + pgvector | 关系数据 + 向量检索一体 |
| 对象存储 | MinIO（自建）或 S3（云） | 图片、附件、模型文件 |
| 缓存 | Redis（可选） | 会话、限流、任务队列 |
| 认证 | JWT + OAuth2 | 支持邮箱注册、第三方登录 |
| 反向代理 | Caddy 或 Nginx | 自动 HTTPS |
| 部署 | Docker Compose | 一键部署，易于维护 |

### 6.3 数据模型

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
  user_id UUID REFERENCES users(id),
  device_name TEXT,
  platform TEXT, -- android / ios / web
  last_sync_at TIMESTAMPTZ
)

-- 笔记
notes (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  title TEXT,
  content TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  version INT DEFAULT 1
)

-- 附件
attachments (
  id UUID PRIMARY KEY,
  note_id UUID REFERENCES notes(id),
  file_path TEXT,
  mime_type TEXT,
  size BIGINT,
  ocr_text TEXT,
  created_at TIMESTAMPTZ
)

-- 向量
embeddings (
  id UUID PRIMARY KEY,
  note_id UUID REFERENCES notes(id),
  attachment_id UUID REFERENCES attachments(id),
  chunk_text TEXT,
  vector VECTOR(768),
  created_at TIMESTAMPTZ
)

-- 同步日志
sync_log (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  entity_type TEXT,
  entity_id UUID,
  operation TEXT, -- create / update / delete
  timestamp TIMESTAMPTZ,
  version INT
)
```

### 6.4 API 设计

| 端点 | 方法 | 说明 |
|---|---|---|
| `/auth/register` | POST | 注册 |
| `/auth/login` | POST | 登录，返回 JWT |
| `/auth/refresh` | POST | 刷新 Token |
| `/notes` | GET | 获取笔记列表（支持分页、过滤） |
| `/notes` | POST | 创建笔记 |
| `/notes/{id}` | PUT | 更新笔记 |
| `/notes/{id}` | DELETE | 软删除 |
| `/notes/{id}/attachments` | POST | 上传附件 |
| `/search/semantic` | POST | 语义检索 |
| `/sync/push` | POST | 推送本地变更 |
| `/sync/pull` | POST | 拉取云端变更 |

### 6.5 同步策略

- **离线优先**：本地写入 → 加入同步队列 → 联网后自动推送。
- **增量同步**：基于 `updated_at` 和 `version` 字段。
- **冲突解决**：
  - 简单场景：Last-Write-Wins。
  - 复杂场景：CRDT（推荐 `automerge` 或 `yjs` 的 Dart 绑定）。
- **删除**：软删除 + 墓碑记录，确保多端一致。
- **同步触发**：
  - 应用启动时。
  - 网络恢复时（`connectivity_plus`）。
  - 用户手动下拉刷新。
  - 定时后台同步（移动端可选）。

### 6.6 安全与加密

- 强制 HTTPS。
- JWT 短期有效 + Refresh Token。
- 可选端到端加密：
  - 客户端加密笔记内容，服务端只存密文。
  - 密钥由用户主密码派生（Argon2 / PBKDF2）。
  - 服务端无法解密，隐私最强。
- API 限流：Redis + 滑动窗口。
- 审计日志：记录关键操作。

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

- 推理后端：`flutter_gemma` / `llamadart` + llama.cpp（Vulkan GPU 加速）。
- 模型：GGUF Q4_K_M，1B-3B 参数在 8GB 设备上余量约 3-4GB。
- OCR：`flutter_paddle_ocr` 的 Android 后端（Paddle Lite + JNI）。
- 云端 API：`dio` + Provider 抽象，Key 存于 Keystore。
- 同步：`connectivity_plus` + 后台任务。

### iOS

- 推理后端：`flutter_gemma` / `llamadart` + Metal GPU 加速。
- iPhone 15 Pro 上约 15 tok/s。
- 低配 iPhone：LFM2.5-VL-450M（量化后约 388MB）+ 轻量 RAG。
- OCR：`flutter_paddle_ocr` iOS 后端，需真机测试。
- 云端 API：Key 存于 Keychain。
- 同步：Background Fetch + 手动刷新。

### Web

- 推理后端：`flutter_gemma` WebGPU 路径，或 `llamadart` WebGPU + CPU 回退。
- 模型：Gemma 3n E2B Q2_K，>2GB 模型需 OPFS 流式加载。
- OCR：`flutter_paddle_ocr` Web 后端（paddleocr-js + ONNX Runtime Web）。
- 向量存储：wa-sqlite + OPFS。
- 云端 API：Key 加密存于 IndexedDB，或走后端代理。
- 同步：Service Worker + 后台同步（可选）。

---

## 8. RAG 与图文混合检索

### 文本笔记

1. 用 `flutter_gemma` 的 `EmbeddingModel` 生成 768 维向量。
2. 存入 `VectorStoreRepository`。
3. 检索时用 HNSW 索引做近似最近邻搜索。
4. 云端模式下，可将向量同步到自建后端的 pgvector，实现跨端检索。

### 图片 / 截图

1. 用 VLM 提取图像描述与 OCR 文本。
2. 将描述文本存入同一向量索引。
3. 实现跨模态检索。
4. 附件原图可上传到自建后端 MinIO，多端共享。

### 轻量方案

`on_device_rag` 纯 Dart 零依赖，使用内存内余弦相似度搜索，适合笔记量不大的场景。缺点是没有持久化存储，每次启动需重建索引。

### 云端增强检索

- 自建后端 pgvector 支持大规模向量检索。
- Web 端可直接查询后端语义检索接口，无需本地加载 Embedding 模型。
- 本地与云端索引可通过同步引擎保持一致。

---

## 9. 关键配置与坑点

| 问题 | 解决方案 |
|---|---|
| Web 端跨域隔离 | 多线程 Wasm 需 `COOP: same-origin` + `COEP: require-corp` |
| Web 端大模型加载 | >2GB 用 OPFS streaming，<2GB 用 Cache API |
| WebGPU 要求 | Chrome/Edge ≥ 113，Safari 26+ |
| iOS 模拟器 OCR | Paddle Lite 仅 arm64-device-only，必须真机测试 |
| Android NDK 冲突 | 锁定 NDK r25c |
| 模型加载内存峰值 | 分块加载，512MB 数据块预加载 |
| 云端 API Key 泄露 | `flutter_secure_storage` + 可选后端代理 |
| 同步冲突 | Last-Write-Wins 或 CRDT |
| 自建后端部署 | Docker Compose + Caddy 自动 HTTPS |
| 端到端加密 | 客户端加密，服务端只存密文 |

---

## 10. 分阶段实施路线

### Phase 1 — Web 端核心验证（2-3 周）

- Flutter Web 项目初始化。
- 笔记 CRUD + SQLite（Wasm）本地存储。
- 集成 `flutter_gemma`，跑通 Gemma 3n E2B 文本推理。
- 实现“输入笔记 → AI 自动生成标签/分类”。

### Phase 2 — 移动端集成 + 多模态（3-4 周）

- 同一套 Dart 代码在 Android/iOS 启用 llama.cpp 原生后端。
- 集成 `flutter_paddle_ocr` 实现图片 OCR。
- 启用 `flutter_gemma` 视觉能力，实现“发图片给 AI 理解”。

### Phase 3 — RAG 与检索（2-3 周）

- 集成 Embedding + VectorStore，实现语义搜索。
- 图片描述存入同一索引，实现图文混合检索。
- Web 端调优 OPFS streaming 与大模型加载。

### Phase 4 — 云端 API 接入（2 周）

- 实现 `LlmProvider` 抽象层。
- 接入 OpenAI / Anthropic / Gemini / DeepSeek 等 Provider。
- 实现手动/自动切换与降级策略。
- API Key 安全存储。

### Phase 5 — 自建后端与同步（3-4 周）

- 搭建 FastAPI + PostgreSQL + pgvector + MinIO。
- 实现用户认证、笔记 CRUD、附件上传、语义检索 API。
- 实现离线队列 + 增量同步 + 冲突解决。
- 可选端到端加密。

### Phase 6 — 打磨与兼容（2 周）

- WebGPU 不可用时的降级提示。
- 模型下载管理、进度提示、缓存策略。
- 内存剖析，确保 8GB 设备 Web 端不崩溃。
- 多设备同步测试与边界场景处理。

---

## 11. 关键决策建议

- **主力框架**：`flutter_gemma`，Web 端 RAG 与向量存储最完整，原生支持 Gemma 3n 视觉能力。
- **备选框架**：`llamadart`，需要 GGUF 原生 WebGPU 加速或 CPU 回退时切换。
- **模型策略**：
  - Web 默认：Gemma 3n E2B Q2_K。
  - 低内存设备：Llama 3.2 1B Q4_K_M + `flutter_paddle_ocr`。
  - 算力不足：切换到云端 API（GPT-4o-mini / Gemini Flash / DeepSeek）。
- **OCR 策略**：VLM 处理通用图像理解，PaddleOCR 兜底精确文字提取。
- **云端 API 策略**：默认客户端直连 + Key 本地加密；企业用户可选后端代理。
- **后端策略**：自建 FastAPI + PostgreSQL + pgvector + MinIO，Docker Compose 部署。
- **同步策略**：离线优先 + 增量同步 + Last-Write-Wins（简单）或 CRDT（复杂）。
- **隐私策略**：默认全本地；云端模式明确提示；敏感笔记强制本地；可选端到端加密。

---

## 12. Markdown 导出功能实现建议（可选）

如果指的是在记事本软件中支持导出/生成 Markdown 文件，Flutter 侧可以这样实现：

- 使用 `markdown` 包将结构化笔记转为 Markdown 字符串。
- 使用 `path_provider` 获取本地存储路径。
- 使用 `share_plus` 分享或导出 `.md` 文件。
- Web 端可用 `universal_html` 触发浏览器下载。
- 自建后端可提供 `/export/markdown` 接口，批量导出全部笔记为 `.zip`。

示例依赖：

```yaml
dependencies:
  markdown: ^7.3.0
  path_provider: ^2.1.5
  share_plus: ^10.1.4
```

---

## 13. 品牌文案（可选）

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

## 14. 后续可补充内容

- `pubspec.yaml` 完整依赖配置
- `web/index.html` 跨域隔离配置
- 模型下载与缓存管理设计
- 笔记数据结构与 SQLite 表设计
- RAG 分块策略与检索参数调优
- Markdown 导出示例代码
- 云端 Provider 具体请求/响应适配代码
- 自建后端 OpenAPI 规范
- 端到端加密密钥派生与轮换方案
- 多设备同步冲突解决测试用例

---

## 15. 结论

**记不住（ForgotIt）** 以 Flutter 为统一 UI 与业务层，以 `flutter_gemma` / `llamadart` 为端侧推理核心，以 `flutter_paddle_ocr` 为 OCR 兜底，以 HNSW + OPFS 为本地 RAG 存储，可覆盖 Android、iOS、PC Web 三端。

通过 **LLM Provider 抽象层**，本地算力不足时可无缝切换到云端大模型 API，兼顾离线隐私与云端能力。

通过 **自建后端**（FastAPI + PostgreSQL + pgvector + MinIO），实现多设备同步、备份与跨端检索，数据完全自主可控。

Web 端受浏览器内存限制，推荐优先使用 Gemma 3n E2B Q2_K 或降级到 Llama 3.2 1B Q4_K_M；算力不足时可直接切换云端 API。移动端可启用 Metal / Vulkan 加速，获得更好的推理速度。

整体技术栈已具备可行性，建议从 Web 端核心验证开始，再逐步扩展到移动端、多模态、云端 API 与自建后端。

> 脑子寄存处，正式营业。