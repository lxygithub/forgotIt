// 「记不住」数据库客户端（双部署支持，v1.3）
//  - 默认（Node / VPS / Docker）：SQLite 文件库，DATABASE_URL 指定路径，行为与 v1.x 完全一致
//  - DB_DRIVER=d1（Cloudflare Workers）：使用 OpenNext 注入的 D1 binding
//    （wrangler.jsonc：d1_databases.binding = "DB"），同一份 prisma/schema.prisma（SQLite 方言）
//  差异只在驱动适配器，部署说明见部署文档 §11
import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'
import { getD1Binding } from '@/lib/cf'
import { PrismaClient as PrismaClientWorker } from '@/generated/prisma-worker/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  if (process.env.DB_DRIVER === 'd1') {
    // Workers：用新生成器的 workerd 客户端（wasm 引擎经 '?module' 静态导入，
    // 由 wrangler/OpenNext 编译注册；workerd 禁止运行时 WebAssembly.compile）。
    // 客户端由 `bun run build:cf` 自动生成到 src/generated/prisma-worker（见部署文档 §11）。
    return new PrismaClientWorker({ adapter: new PrismaD1(getD1Binding()) }) as unknown as PrismaClient
  }
  return new PrismaClient({
    log: ['query'],
  })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
