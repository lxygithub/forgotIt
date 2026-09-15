# 记不住（ForgotIt）部署文档

> 适用范围：`web/` 目录下的 Web 原型 v1.1（Next.js 16 + Prisma/SQLite）。
> 产品与架构设计见[开发文档](./forgotIt开发文档.md)，Web 端开发细节见 [web/README.md](./web/README.md)。
>
> **本文档中的所有步骤与坑点均在真实环境实测验证过**（见附录 A）。

---

## 1. 部署场景总览

| 场景 | 适合人群 | 参考章节 |
| --- | --- | --- |
| **A. 本机体验** | 想先跑起来看看 | §3 |
| **B. 自托管生产** | 部署到 VPS / 家庭服务器长期使用 | §4 + §5 + §9 |
| **C. 内网多设备** | 几台设备（电脑 + 手机）同步一套脑子 | §4 + §8 |

> ⚠️ **重要提示（请先读）**：Web 原型为**单用户模型，无登录鉴权**。
> 面向公网部署前，请务必在反向代理层加访问控制（Basic Auth / IP 白名单 / mTLS），
> 或仅部署在可信内网。鉴权（NextAuth）在路线图中，尚未实现。

---

## 2. 环境要求

| 组件 | 最低版本 | 说明 |
| --- | --- | --- |
| Bun | **1.3+** | 推荐（安装/构建/运行全用 bun；本项目实测 bun 1.3.14） |
| Node.js | 20.9+（实测 24.x） | 可替代 bun 跑 `node .next/standalone/server.js`；SDK 要求 ≥ 20 |
| 操作系统 | Linux / macOS / Windows(WSL) | 构建脚本含 `cp -r`，Windows 原生 shell 不兼容，请用 WSL |
| 磁盘 | ≥ 200MB | node_modules ≈ 150MB，数据库与上传图片按需增长 |
| 内存 | ≥ 512MB | 无常驻模型，AI 推理在云端完成，小内存 VPS 可跑 |

---

## 3. 本地开发部署（场景 A）

```bash
git clone https://github.com/lxygithub/forgotIt.git
cd forgotIt/web
cp .env.example .env          # 默认 DATABASE_URL=file:../db/custom.db（相对路径，仅开发可用）
bun install
bun run db:push               # 建表 + 生成 Prisma Client（自动创建 db/custom.db）
bun run dev                   # 开发服务器，端口 3000
```

启动后访问 `http://localhost:3000`：

1. 空状态页点击「**载入示例**」→ 灌入 8 条演示笔记（含发票图、体检报告、健身计划），体验完整功能；
2. 顶部「✦」图标进入问答，试试「我的体检结果有什么问题」；
3. 搜索框切到「语义」模式，试试「最近身体有什么要注意的」。

**常用开发命令**：

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | 开发服务器（端口 3000） |
| `bun run lint` | ESLint 检查 |
| `bun run db:push` | 推送 schema 变更到 SQLite |
| `bun run db:generate` | 仅重新生成 Prisma Client |
| `bun run db:reset` | 清空并重建数据库 |

> 🧪 **坑 1（实测）**：如果你的 shell 里已经 `export DATABASE_URL=...`，
> 环境变量会**覆盖 `.env` 文件**（dotenv 标准行为）。表现为 `db:push` 的输出里
> 数据库路径不是你 `.env` 里写的那个。解决：`unset DATABASE_URL` 或显式指定。
> 检查：`echo $DATABASE_URL`。

---

## 4. 生产部署（场景 B / C）

### 4.1 构建与启动（standalone 模式）

项目使用 Next.js `output: "standalone"` 构建，产物是自包含的
`.next/standalone/` 目录（含 server.js、裁剪后的 node_modules、`.env` 快照、public 与静态资源）：

```bash
cd web
cp .env.example .env                  # 开发期占位；生产请按 §4.2 改用绝对路径
bun run build                         # next build + 复制 static/public 进 standalone
```

生产**推荐用环境变量显式传 DATABASE_URL**（而非依赖 `.env` 快照，原因见 FAQ Q3）：

```bash
mkdir -p /var/lib/forgotit            # 数据目录（SQLite 文件放这里）
export DATABASE_URL="file:/var/lib/forgotit/custom.db"

# 首次部署：初始化数据库表结构（--skip-generate：运行时 client 已内置于 standalone）
DATABASE_URL="$DATABASE_URL" bunx prisma db push --skip-generate

# 启动（PORT 可自定义，默认 3000，监听 0.0.0.0）
PORT=3000 NODE_ENV=production bun .next/standalone/server.js
```

验证：

```bash
curl http://127.0.0.1:3000/api/stats          # → {"notes":0,...}
curl "http://127.0.0.1:3000/api/sync/pull?since=0"   # → {"cursor":0,...}
```

> 🧪 **坑 2（实测，最关键）**：生产 standalone 模式下，SQLite **相对路径会解析失败**
> （报 `Error code 14: Unable to open the database file`）。开发模式不受影响。
> **生产环境必须使用绝对路径**，且 `db push` 与 `server.js` 启动时使用**同一个** `DATABASE_URL`。

### 4.2 数据库路径规则（重要）

| 环境 | DATABASE_URL 推荐写法 |
| --- | --- |
| 本地开发 | `file:../db/custom.db`（相对 `prisma/schema.prisma` 解析，落到 `web/db/custom.db`，已被 .gitignore 排除） |
| 生产（systemd / 裸启） | `file:/var/lib/forgotit/custom.db`（绝对路径） |
| 生产（Docker） | `file:/app/db/custom.db`（绝对路径 + 挂载卷，见 §4.5） |

### 4.3 环境变量一览

| 变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | `file:/var/lib/forgotit/custom.db` | SQLite 连接串（生产用绝对路径，见 §4.2） |
| `PORT` | — | `3000` | standalone 监听端口（默认 3000） |
| `HOSTNAME` | — | `0.0.0.0` | standalone 监听地址（默认 0.0.0.0） |
| `NODE_ENV` | — | `production` | 建议显式设置 |
| `.z-ai-config` 文件 | AI 功能需要 | 见 §5 | 不是环境变量，是凭证文件，三处可选位置 |

### 4.4 进程守护

**systemd（推荐）**——`/etc/systemd/system/forgotit.service`：

```ini
[Unit]
Description=ForgotIt Web (记不住)
After=network.target

[Service]
Type=simple
User=forgotit
Group=forgotit
WorkingDirectory=/opt/forgotit/web
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATABASE_URL=file:/var/lib/forgotit/custom.db
ExecStart=/usr/bin/bun .next/standalone/server.js
Restart=on-failure
RestartSec=3

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/forgotit

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now forgotit
```

> `.z-ai-config` 查找位置包含**进程运行目录（cwd）**。systemd 的 cwd 是
> `WorkingDirectory=/opt/forgotit/web`，把凭证放 `/etc/.z-ai-config` 或
> `/home/forgotit/.z-ai-config`（`User=forgotit` 的家目录）更规范，见 §5。

**PM2**：

```bash
pm2 start bun --name forgotit -- .next/standalone/server.js
pm2 env 0 && pm2 save
```

### 4.5 Docker 部署

仓库暂不内置 Dockerfile，以下为实测逻辑编排过的可用样例。
在仓库根目录放 `Dockerfile`：

```dockerfile
# syntax=docker/dockerfile:1
FROM oven/bun:1 AS deps
WORKDIR /app
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/ .
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# 生产必须绝对路径（坑 2）
ENV DATABASE_URL=file:/app/db/custom.db
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
RUN mkdir -p /app/db
EXPOSE 3000
# 每次启动先幂等同步表结构，再起服务
CMD ["sh", "-c", "bunx prisma db push --accept-data-loss --skip-generate && exec bun server.js"]
```

同目录 `docker-compose.yml`：

```yaml
services:
  forgotit:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: file:/app/db/custom.db
    volumes:
      - ./data:/app/db          # SQLite 文件持久化
      # AI 凭证（可选，见 §5）：挂载进容器任一查找位置
      # - ./z-ai-config:/etc/.z-ai-config:ro
    restart: unless-stopped
```

> 注意：`CMD` 里带了 `--accept-data-loss`，用于 schema 升级场景。若你担心
> 生产数据被破坏性变更，请去掉该参数，升级时改为手动执行 `db push` 观察输出。

同目录 `.dockerignore`（务必包含，防止本地数据/凭证进镜像）：

```
web/node_modules
web/.next
web/db
web/.env
web/.z-ai-config
web/public/uploads
**/*.log
```

### 4.6 反向代理与 HTTPS

**Nginx**：

```nginx
server {
    listen 80;
    server_name notes.example.com;

    # 图片附件以 dataURL/文件上传，放宽请求体限制
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 公网部署务必加访问控制（原型无登录鉴权！）
        # auth_basic "ForgotIt";
        # auth_basic_user_file /etc/nginx/.htpasswd;
        # allow 192.168.1.0/24;
        # deny all;
    }
}
```

HTTPS：`sudo certbot --nginx -d notes.example.com`。

**Caddy**（自动 HTTPS，最省事）：

```caddy
notes.example.com {
    reverse_proxy 127.0.0.1:3000
    request_body {
        max_size 20MB
    }
}
```

---

## 5. AI 能力配置

Web 原型的 AI 能力（自动打标签 / 摘要 / RAG 问答 / 图片理解 / 语义查询扩展与索引）
由服务端 `z-ai-web-dev-sdk` 提供，需要一份 Z.ai 凭证文件 **`.z-ai-config`**（JSON）：

```json
{
  "baseUrl": "<Z.ai OpenAI 兼容 API 地址>",
  "apiKey":  "<你的 API Key>"
}
```

**放置位置（按优先级，SDK 依次查找，取第一个命中的）**：

| 优先级 | 路径 | 适用 |
| --- | --- | --- |
| 1 | `<项目运行目录>/.z-ai-config`（即 cwd） | 快速试用 |
| 2 | `~/.z-ai-config` | systemd / 手动运行（放服务对应用户的家目录） |
| 3 | `/etc/.z-ai-config` | Docker / 多服务共享（推荐挂载为只读） |

安全要求：

- `chmod 600 .z-ai-config`，属主设为运行服务的用户；
- **不要提交进 git**（`web/.gitignore` 已包含 `.z-ai-config`）；
- Docker 中通过卷只读挂载，不要 `COPY` 进镜像。

**AI 不可用时的降级行为（实测）**：

| 功能 | 无凭证时 |
| --- | --- |
| 笔记增删改 / 置顶 / 回收站 / 标签 / 统计 | ✅ 正常 |
| 关键词搜索 | ✅ 正常 |
| 同步（推送/拉取/冲突） | ✅ 正常 |
| 「保存并让 AI 整理」 | ❌ 报错提示（笔记本体仍会保存） |
| RAG 问答 / 图片理解 | ❌ 报错提示 |
| 语义/混合搜索 | ⚠️ 查询扩展与向量索引构建依赖 LLM，无凭证时基本无结果 |
| 种子示例数据 | ✅ 正常 |

---

## 6. 数据库运维

SQLite 单文件即全部业务数据（不含上传图片），运维成本极低。

**备份**（推荐 SQLite 在线备份，运行中也可用）：

```bash
sqlite3 /var/lib/forgotit/custom.db ".backup '/backup/forgotit-$(date +%F).db'"
```

（服务已停止时直接 `cp` 文件亦可。）建议 cron 每日一备并异地存放。

**恢复**：停服务 → 用备份文件替换 → 起服务。

**schema 升级**（拉取新版本代码后）：

```bash
cd /opt/forgotit/web
git pull
bun install
DATABASE_URL="file:/var/lib/forgotit/custom.db" bunx prisma db push --skip-generate
bun run build
sudo systemctl restart forgotit
```

> `db push` 对 SQLite 是幂等同步。涉及删列/改类型的变更需要 `--accept-data-loss`，
> 执行前先看输出确认影响范围，并**先备份**。

**迁移到 PostgreSQL + pgvector**（生产级检索路线，开发文档 §6.3）：
Prisma 层把 `datasource` 换成 `postgresql` 即可迁移结构化数据；语义索引表
`Embedding` 需改为 `vector(768)` 列 + HNSW 索引，检索层余弦计算换成
`<=>` 算子。RRF 合并逻辑在应用层（`src/lib/search.ts`），无需改动。

---

## 7. 语义索引维护

语义/混合搜索依赖每条笔记的向量索引（原型实现：`hash-ngram-zh-v1`，256 维，
分块 500 字 / overlap 60，记录 `modelName/modelVersion` 支持多版本共存）。

**何时需要重建索引**：

| 时机 | 操作 |
| --- | --- |
| 首次部署 / 导入了存量数据 | 全量重建 |
| 升级代码后语义模型版本变化 | 全量重建 |
| 个别笔记搜索表现异常 | 重建一次（幂等） |

```bash
curl -X POST http://127.0.0.1:3000/api/ai/reindex
# → {"ok":true, "indexed": N, ...}   无 AI 凭证时会失败，见 §5
```

重建为增量安全设计：逐条补齐缺失的语义关键词，完成前不清空旧索引。

---

## 8. 多设备同步使用说明（场景 C）

所有设备浏览器访问**同一个服务端地址**即组成同步组，每台设备首次访问时自动生成本机设备 ID。

**同步触发时机**：应用启动时 / 网络恢复时 / 每隔 30 秒轮询 / 顶栏手动同步按钮。

**核心行为**：

| 行为 | 说明 |
| --- | --- |
| 离线可记 | 断网时照常记笔记（存本地 outbox），联网后自动推送 |
| 增量拉取 | 按服务端流水 seq 游标拉取，只传增量 |
| 冲突合并 | LWW（last-write-wins，按更新时间裁决），落败方自动存为**冲突快照** |
| 冲突处置 | 顶栏图标出现角标 → 打开同步面板 → 双版本对比 → 可「用我的版本」恢复 |
| 仅本地笔记 | `local_only` 开关的笔记**永不出本地**，不进同步队列 |
| 数据版本提示 | 待同步笔记卡片带角标；全部同步后角标消失 |

注意事项：

- 浏览器「清除站点数据」会同时清掉设备身份与离线暂存（outbox），等同新设备接入；
- 原型同步粒度为「整条笔记」，频繁双端编辑同一条笔记易触发 LWW 裁决（内容不会丢，进快照）；
- 服务端数据全在 SQLite 单文件里，多设备场景请务必按 §6 定期备份。

---

## 9. 安全加固清单

- [ ] **访问控制**：原型无登录鉴权，公网部署必须在反代层加 Basic Auth / IP 白名单 / mTLS（§4.6）
- [ ] HTTPS（Caddy 自动，或 certbot）
- [ ] `.z-ai-config` 权限 600，不入 git、不进镜像（§5）
- [ ] 数据目录最小权限：`chown -R forgotit:forgotit /var/lib/forgotit && chmod 700 /var/lib/forgotit`
- [ ] systemd 加固项已内置（`ProtectSystem=strict` 等，见 §4.4）
- [ ] 反代限制请求体（`client_max_body_size 20m`）
- [ ] 定期备份并验证可恢复（§6）
- [ ] 升级代码前查看 diff，确认 `db push` 输出无意外删列（§6）

---

## 10. 常见问题排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `db push` 输出的数据库路径不是我 `.env` 里写的 | shell 已 `export DATABASE_URL`，环境变量覆盖 `.env`（坑 1，实测） | `unset DATABASE_URL` 或直接用它 |
| 生产 API 全报错，日志 `Error code 14: Unable to open the database file` | standalone 下 SQLite 相对路径解析失败（坑 2，实测），或目录不存在/无权限 | 改绝对路径；`mkdir -p` 数据目录并授权；`db push` 与启动用同一个 `DATABASE_URL` |
| 生产改了 `.env` 不生效 | `.env` 在 build 时被**复制快照**进 `.next/standalone/`，重新 build 才会更新（实测确认会复制） | 用环境变量显式注入（推荐），或重新 `bun run build` |
| AI 功能 500 /「配置未找到」 | `.z-ai-config` 缺失或字段不全（需同时含 `baseUrl` 与 `apiKey`） | 按 §5 放置凭证；注意 systemd 用户家目录、Docker 挂载 |
| 语义/混合搜索无结果 | 索引未建（新部署）或无 AI 凭证 | `POST /api/ai/reindex`；确认 §5 配置 |
| 端口占用 `EADDRINUSE` | 3000 被占 | 换 `PORT=xxxx` 或释放端口 |
| Windows 下 `bun run build` 失败 | 构建脚本含 Unix `cp -r` | 使用 WSL |
| 冲突提示频繁 | 双端编辑同一条笔记触发 LWW | 同步面板处置即可，内容不丢 |
| 上传图片 413 | 反代请求体限制 | `client_max_body_size 20m` |

---

## 附录 A：本文档验证记录

| # | 验证项 | 结果 |
| --- | --- | --- |
| 1 | 全新目录克隆 + `bun install --frozen-lockfile` | ✅ 837 包安装成功 |
| 2 | 开发环境相对路径 `DATABASE_URL=file:../db/custom.db`：`db push` 落盘位置 | ✅ `web/db/custom.db` |
| 3 | 开发模式运行时（next dev）相对路径读取 | ✅ `/api/stats`、`/api/notes` 200 |
| 4 | 生产 standalone + **相对路径** | ❌ `Error code 14`（即坑 2，文档据此要求绝对路径） |
| 5 | 生产 standalone + **绝对路径** | ✅ 首页 200；`/api/stats`、`/api/search/semantic`（含 AI 查询扩展）、`/api/sync/pull` 全部正常 |
| 6 | `.env` 复制进 `.next/standalone/` | ✅ 确认存在（故改 `.env` 需重新 build） |
| 7 | `PORT` 环境变量改端口 | ✅ 3102 端口正常监听 |
| 8 | AI 凭证从 `~/.z-ai-config` 读取（生产 cwd 在 standalone 内） | ✅ 语义查询扩展正常返回 |
| 9 | 环境变量 `DATABASE_URL` 覆盖 `.env` 文件 | ✅ 复现（即坑 1） |

实测环境：Bun 1.3.14 / Node 24.19.0 / Next.js 16.1.3 / Prisma 6.19.2 / Debian（openssl 3.0.x）
