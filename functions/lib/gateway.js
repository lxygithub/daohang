// SQL Gateway 客户端 — 内网数据库统一查询入口（db-gateway.ieop.top）。
// 用法与协议见 sql-gateway 仓库《使用与接入指南》；本文件是其「Cloudflare Worker
// 调用示例」的 JS 转写 + 指南「排错」一节坑 1 的 BigInt 处置。
//
// 纪律（指南原文要求）：
//   * 值必须放进 params，绝不拼接用户输入；PostgreSQL 用 $1/$2，MySQL 用 ?；
//   * 无法参数化的标识符（表名/列名/排序字段）由代码里的固定白名单映射，
//     例如 sort === 'created' ? 'created_at' : 'title'；
//   * 先以 read-only 接入，确有写需求再逐点放开 read-write；
//   * 错误只保留 error/requestId，不把 SQL 参数或结果写进日志。

// BigInt 参数归一化：int64（LIMIT/OFFSET、COUNT、整数列）在 JSON.stringify 时会
// 抛 TypeError，被外层 catch 包成「连不上 Gateway」——错误发生在请求发出前，
// 网关侧零日志。安全整数范围内转 number，超出范围转十进制字符串交给数据库解析。
function serializeBigInt(_key, value) {
  if (typeof value !== 'bigint') return value
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString()
}

export const GATEWAY_STATEMENT_LIMIT = 20   // 协议限制：单请求最多 20 条语句
export const GATEWAY_BODY_LIMIT = 256 * 1024 // 协议限制：请求体 ≤ 256 KiB

/**
 * 执行一次网关查询。
 * @param {{ SQL_GATEWAY_URL?: string, SQL_GATEWAY_TARGET?: string }} env Pages 运行时环境
 * @param {string} target 网关侧配置的数据源名（如 forgotit-postgres / local-mysql）
 * @param {'read-only'|'read-write'} mode 模式；网关按模式使用受限只读/读写账号
 * @param {Array<{sql: string, params?: unknown[]}>} statements 同一短事务内顺序执行
 * @returns {Promise<{requestId: string, target: string, durationMs: number,
 *   results: Array<{columns?: string[], rows?: Record<string, unknown>[], affectedRows?: number}>}>}
 */
export async function gatewayQuery(env, target, mode, statements) {
  const url = env.SQL_GATEWAY_URL
  if (!url) throw new Error('Gateway NOT_CONFIGURED; 未配置 SQL_GATEWAY_URL（wrangler.toml [vars]）')
  if (!Array.isArray(statements) || statements.length === 0)
    throw new Error('Gateway BAD_REQUEST; statements 不能为空')
  if (statements.length > GATEWAY_STATEMENT_LIMIT)
    throw new Error(`Gateway BAD_REQUEST; 单请求最多 ${GATEWAY_STATEMENT_LIMIT} 条语句，实际 ${statements.length}`)

  const body = JSON.stringify({ target, mode, statements }, serializeBigInt)
  if (body.length > GATEWAY_BODY_LIMIT)
    throw new Error(`Gateway BAD_REQUEST; 请求体 ${body.length} 字节超出 256 KiB 上限，请拆分请求`)

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    // 保留底层原因（AbortError=10s 超时，其余为网络/Tunnel 故障），不吞成一句「连不上」
    throw new Error(
      `Gateway UNREACHABLE; ${e?.name === 'TimeoutError' ? '10s 超时' : e?.message || 'fetch 失败'}（网关侧应无对应日志，先查 WAF 放行与 Tunnel）`,
    )
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Gateway BAD_RESPONSE; HTTP ${response.status}，响应非 JSON（403 多为 WAF 拦截，属预期内配置未完成）`)
  }

  if (!response.ok) {
    const failure = payload || {}
    throw new Error(`Gateway ${failure.error || response.status}; requestId=${failure.requestId ?? 'unknown'}: ${failure.message || '无详细信息'}`)
  }
  return payload
}

/** 取第一条结果的第一行，空结果返回 null —— 大多数读取场景的收口写法。 */
export function firstRow(result) {
  return result?.results?.[0]?.rows?.[0] ?? null
}
