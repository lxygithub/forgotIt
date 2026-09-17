/**
 * 把 PrismaPg 需要的 pg.Pool 接口映射到 SQL Gateway 的 HTTPS 协议。
 *
 * 这不是给业务代码直接调用的客户端：业务仍使用 Prisma。普通 SQL 使用 Gateway 的单请求事务；
 * Prisma 开启事务时才使用 Gateway 的 15 秒受控会话，避免改写全站 Prisma 调用点。
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolClient, type QueryResult } from 'pg';

const TRANSACTION_PROTOCOL = 'prisma-pg';
const REQUEST_TIMEOUT_MS = 12_000;

type GatewayResult = {
  columns?: string[];
  fieldTypeIds?: number[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  affectedRows?: number;
};

type GatewayFailure = { error: string; message: string; requestId?: string };

class GatewayDatabaseError extends Error {
  readonly code = 'XX000';
  readonly severity = 'ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'GatewayDatabaseError';
  }
}

function extractQuery(input: unknown, values?: unknown[]): { sql: string; params: unknown[] } {
  if (typeof input === 'string') return { sql: input, params: values ?? [] };
  if (input && typeof input === 'object') {
    const config = input as { text?: unknown; values?: unknown };
    if (typeof config.text === 'string') {
      return { sql: config.text, params: values ?? (Array.isArray(config.values) ? config.values : []) };
    }
  }
  throw new GatewayDatabaseError('Prisma 向 Gateway 发送了不支持的查询格式');
}

function isReadOnlySql(sql: string): boolean {
  // 仅把明确的读取语句降权到只读账号。WITH 可能包含写 CTE，因此宁可走受限写账号。
  const firstToken = sql.trimStart().replace(/^(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)+/, '').trimStart().match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
  return firstToken === 'SELECT' || firstToken === 'EXPLAIN' || firstToken === 'SHOW';
}

// Prisma 的查询编译器会把 int64 参数（LIMIT/OFFSET、整数列等）以 BigInt 形式交给适配器，
// 而 JSON.stringify 遇到 BigInt 会直接抛 "Do not know how to serialize a BigInt"。
// 这个异常发生在请求发出之前，必须在这里归一化，否则表现为「连不上 Gateway」。
// 安全整数范围内转 number（LIMIT/OFFSET 等场景），超出范围转十进制字符串由 PostgreSQL 解析。
function serializeBigInt(_key: string, value: unknown): unknown {
  if (typeof value !== 'bigint') return value;
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString();
}

function binaryValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const binary = value as { $binary?: unknown; encoding?: unknown };
  if (binary.encoding !== 'base64' || typeof binary.$binary !== 'string') return value;
  const decoded = atob(binary.$binary);
  return Array.from(decoded, (char) => char.charCodeAt(0));
}

function normalizeResultValue(value: unknown, fieldTypeId: number): unknown {
  const restoredBinary = binaryValue(value);
  // node-postgres 的 Prisma adapter 将 JSON 列交给 Prisma engine 前保留为 JSON 字符串。
  if ((fieldTypeId === 114 || fieldTypeId === 3802) && typeof restoredBinary !== 'string') {
    return JSON.stringify(restoredBinary);
  }
  return restoredBinary;
}

function toPgResult(result: GatewayResult): QueryResult<unknown[]> {
  const columns = result.columns ?? [];
  const fieldTypeIds = result.fieldTypeIds ?? columns.map(() => 25); // text OID：仅用于没有行的命令结果
  return {
    command: '',
    rowCount: result.rowCount ?? result.affectedRows ?? 0,
    oid: 0,
    fields: columns.map((name, index) => ({ name, dataTypeID: fieldTypeIds[index] ?? 25 })) as QueryResult<unknown[]>['fields'],
    rows: (result.rows ?? []).map((row) => columns.map((name, index) => normalizeResultValue(row[name], fieldTypeIds[index] ?? 25))),
  };
}

class GatewayApi {
  constructor(private readonly url: string, private readonly target: string) {}

  async call<T>(body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body, serializeBigInt),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // 请求发出前的本地异常（如参数无法序列化）在这里会表现为「连不上」，
      // 必须带上原始原因，否则线上只能看到 XX000 无法连接 SQL Gateway。
      const reason = error instanceof Error && error.message ? error.message : String(error);
      throw new GatewayDatabaseError(`无法连接 SQL Gateway：${reason}`);
    }
    const payload = await response.json().catch(() => undefined) as T | GatewayFailure | undefined;
    if (!response.ok) {
      const failure = payload as GatewayFailure | undefined;
      throw new GatewayDatabaseError(`SQL Gateway 请求失败：${failure?.error ?? response.status}${failure?.requestId ? ` (${failure.requestId})` : ''}`);
    }
    return payload as T;
  }

  async query(sql: string, params: unknown[]): Promise<QueryResult<unknown[]>> {
    const response = await this.call<{ results: GatewayResult[] }>({
      target: this.target,
      mode: isReadOnlySql(sql) ? 'read-only' : 'read-write',
      statements: [{ sql, params }],
    });
    return toPgResult(response.results[0] ?? {});
  }

  async startTransaction(): Promise<string> {
    const response = await this.call<{ sessionId: string }>({ protocol: TRANSACTION_PROTOCOL, operation: 'start-transaction', target: this.target });
    if (!response.sessionId) throw new GatewayDatabaseError('SQL Gateway 未返回事务会话');
    return response.sessionId;
  }

  async transactionQuery(sessionId: string, sql: string, params: unknown[]): Promise<QueryResult<unknown[]>> {
    const response = await this.call<{ result: GatewayResult }>({
      protocol: TRANSACTION_PROTOCOL,
      operation: 'transaction-query',
      sessionId,
      statement: { sql, params },
    });
    return toPgResult(response.result ?? {});
  }

  async closeTransaction(sessionId: string, action: 'commit' | 'rollback'): Promise<void> {
    await this.call({ protocol: TRANSACTION_PROTOCOL, operation: 'close-transaction', sessionId, action });
  }
}

function emptyResult(): QueryResult<unknown[]> {
  return toPgResult({ affectedRows: 0 });
}

function createTransactionClient(api: GatewayApi, sessionId: string): PoolClient {
  let active = true;
  const client = {
    async query(input: unknown, values?: unknown[]) {
      const { sql, params } = extractQuery(input, values);
      const command = sql.trim().replace(/;$/, '').toUpperCase();
      // Gateway 在创建会话时已 BEGIN + SET LOCAL；PrismaPg 随后发出的初始化命令无需重复执行。
      if (command === 'BEGIN' || command.startsWith('SET TRANSACTION')) return emptyResult();
      if (command === 'COMMIT' || command === 'ROLLBACK') {
        if (active) {
          active = false;
          await api.closeTransaction(sessionId, command === 'COMMIT' ? 'commit' : 'rollback');
        }
        return emptyResult();
      }
      if (!active) throw new GatewayDatabaseError('Prisma 事务已结束');
      return api.transactionQuery(sessionId, sql, params);
    },
    release() {
      if (active) {
        active = false;
        // PrismaPg 的 release 不是 awaitable；Gateway 的 15 秒到期回滚仍是最终保护。
        void api.closeTransaction(sessionId, 'rollback').catch(() => undefined);
      }
    },
    on() { return client; },
    removeListener() { return client; },
  };
  return client as unknown as PoolClient;
}

function createGatewayPool(url: string, target: string): Pool {
  // PrismaPg 用 instanceof Pool 判断外部连接池；构造后立即覆写 I/O 方法，因此永远不会直连数据库。
  const pool = new Pool({ max: 1 });
  const api = new GatewayApi(url, target);
  const mutablePool = pool as unknown as {
    query: (input: unknown, values?: unknown[]) => Promise<QueryResult<unknown[]>>;
    connect: () => Promise<PoolClient>;
    end: () => Promise<void>;
  };
  mutablePool.query = async (input, values) => {
    const { sql, params } = extractQuery(input, values);
    return api.query(sql, params);
  };
  mutablePool.connect = async () => createTransactionClient(api, await api.startTransaction());
  mutablePool.end = async () => undefined;
  return pool;
}

export function createGatewayPrismaAdapter(url: string, target = 'forgotit-postgres'): PrismaPg {
  return new PrismaPg(createGatewayPool(url, target), { disposeExternalPool: true });
}
