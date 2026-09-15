// GET /api/admin/users?q=关键字 — 用户列表（仅管理员，支持邮箱子串搜索）
// 返回：id / email / created_at / disabled / 会话数 / 偏好项数，绝不返回 pwd_hash
import { ensureSchema, listUsersWithStats } from '../../lib/db.js'
import { requireAdmin, sessionCookie, isAdminEmail, json } from '../../lib/auth.js'

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, { status: 405 })
  try {
    await ensureSchema(env)
    const sess = await requireAdmin(env, request)
    if (!sess) return json({ error: '需要管理员权限' }, { status: 403 })
    const setCookie = sess.renewToken ? { 'Set-Cookie': sessionCookie(sess.renewToken) } : {}

    const q = new URL(request.url).searchParams.get('q') || ''
    const users = await listUsersWithStats(env, q)
    const data = users.map(u => ({ ...u, isAdmin: isAdminEmail(env, u.email) }))
    return json({ ok: true, users: data, serverTime: Date.now() }, { headers: setCookie })
  } catch (e) {
    return json({ error: e.message || '获取失败' }, { status: 500 })
  }
}
