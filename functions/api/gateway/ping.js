// POST /api/gateway/ping — SQL Gateway 接入验证（仅管理员）。
// 对应指南「接入新的可信项目」第 5 步：从 Worker 发起一条无副作用的 SELECT 1。
// 打通前调用会得到 502 + 原始错误（403=WAF 未放行 / DATABASE_QUERY_FAILED=网关未允许
// 该 target 或缺表 / UNREACHABLE=Tunnel 或网关未起），按 DEPLOY.md「SQL Gateway 接入」排障。
import { ensureSchema } from '../../lib/db.js'
import { requireAdmin, sessionCookie, sameOrigin, json } from '../../lib/auth.js'
import { gatewayQuery } from '../../lib/gateway.js'

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, { status: 405 })
  try {
    await ensureSchema(env)
    const sess = await requireAdmin(env, request)
    if (!sess) return json({ error: '需要管理员权限' }, { status: 403 })
    if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })
    const setCookie = sess.renewToken ? { 'Set-Cookie': sessionCookie(sess.renewToken) } : {}

    const target = env.SQL_GATEWAY_TARGET || 'forgotit-postgres'
    const clientStart = Date.now()
    const result = await gatewayQuery(env, target, 'read-only', [{ sql: 'SELECT 1 AS ok' }])
    const first = result.results?.[0]

    return json(
      {
        ok: true,
        note: 'SQL Gateway 链路打通（WAF → Tunnel → Nginx → Gateway → 数据库）',
        target: result.target,
        durationMs: result.durationMs,
        clientRttMs: Date.now() - clientStart,
        rows: first?.rows ?? [],
        requestId: result.requestId,
      },
      { headers: setCookie },
    )
  } catch (e) {
    return json({ error: e.message || '网关查询失败' }, { status: 502 })
  }
}
