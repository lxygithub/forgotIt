// 「记不住」数据库客户端（2026-09 起：自建 PostgreSQL + SQL Gateway）
//   - Workers 线上：经 Cloudflare WAF + Tunnel 调用家中 SQL Gateway，不直连数据库端口
//   - 本地开发：getCloudflareContext 不可用时，回退到 DATABASE_URL 直连
//
// 【为什么每请求一个客户端】
// Cloudflare Workers 禁止跨请求复用 I/O 对象（socket / 连接池），复用会抛
// "Cannot perform I/O on behalf of a different request"。所以这里不能用 Node 那样的
// 模块级单例，而是以当前请求的 ctx 为键缓存，每个请求拿到独立的连接池。
// Gateway 模式下 pg.Pool 只是一层 Prisma 兼容外观，实际连接与池化都在内网 Gateway。
//
// 对外仍导出 `db`（Proxy 延迟解析），各调用点无需改动。
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context'
import { createGatewayPrismaAdapter } from '@/lib/gateway-pg'

interface HyperdriveEnv {
  HYPERDRIVE?: { connectionString: string }
  SQL_GATEWAY_URL?: string
}

const PG_POOL_MAX = 3

// 以请求上下文对象为键；请求结束后 ctx 被回收，条目随之释放
const requestClients = new WeakMap<object, PrismaClient>()

let nodeFallback: PrismaClient | undefined

function createHyperdriveWorkerClient(connectionString: string): PrismaClient {
  const pool = new Pool({ connectionString, max: PG_POOL_MAX })
  // disposeExternalPool：让 $disconnect() 能真正关掉上面这个 Pool，否则 socket 泄漏
  return new PrismaClientWorker({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
  }) as unknown as PrismaClient
}

function createGatewayWorkerClient(gatewayUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: createGatewayPrismaAdapter(gatewayUrl),
  })
}

function resolveDb(): PrismaClient {
  let ctx: object | undefined
  let connectionString: string | undefined
  let gatewayUrl: string | undefined

  try {
    const cf = getCloudflareContext() as unknown as { env: unknown; ctx: object }
    ctx = cf.ctx
    connectionString = (cf.env as HyperdriveEnv).HYPERDRIVE?.connectionString
    gatewayUrl = (cf.env as HyperdriveEnv).SQL_GATEWAY_URL
  } catch {
    // 非 Workers 环境（如 next dev）：走下面的 DATABASE_URL 直连回退
  }

  if (!ctx || (!gatewayUrl && !connectionString)) {
    if (!nodeFallback) {
      nodeFallback = new PrismaClient({ log: ['query'] })
    }
    return nodeFallback
  }

  let client = requestClients.get(ctx)
  if (!client) {
    client = gatewayUrl ? createGatewayWorkerClient(gatewayUrl) : createHyperdriveWorkerClient(connectionString!)
    requestClients.set(ctx, client)
  }
  return client
}

// Prisma 的方法依赖 this 指向真实客户端，取值时必须 bind
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = resolveDb()
    const value = Reflect.get(client, prop, client)
    if (typeof value === 'function') return value.bind(client)
    return value
  },
}) as PrismaClient
