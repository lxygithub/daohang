// POST /api/user/password  { currentPassword, newPassword }
// 修改密码：验证当前密码 → 更新哈希 → 吊销其他设备的会话（保留当前登录态）。
// 防御：会话鉴权 + 同源校验 + 按用户限流（当前密码错 10 次锁 15 分钟）。
import { ensureSchema, getUserById, updateUserPassword, deleteSessionsExcept } from '../../lib/db.js'
import {
  getSessionUser, verifyPassword, hashPassword, sessionCookie,
  readCookie, COOKIE_NAME, sha256Hex, json, sameOrigin, rateLimit,
} from '../../lib/auth.js'

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, { status: 405 })
  if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })

  try {
    await ensureSchema(env)
    const sess = await getSessionUser(env, request)
    if (!sess) return json({ error: '未登录' }, { status: 401 })
    const setCookie = sess.renewToken ? { 'Set-Cookie': sessionCookie(sess.renewToken) } : {}

    if (!rateLimit(`pwd:${sess.user.id}`)) {
      return json({ error: '尝试过于频繁，请 15 分钟后再试' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const current = String(body.currentPassword || '')
    const next = String(body.newPassword || '')
    if (next.length < 6 || next.length > 128) {
      return json({ error: '新密码长度需在 6-128 位之间' }, { status: 400 })
    }

    const user = await getUserById(env, sess.user.id)
    if (!user || !(await verifyPassword(current, user.pwd_hash))) {
      return json({ error: '当前密码不正确' }, { status: 403 })
    }

    await updateUserPassword(env, user.id, await hashPassword(next))

    // 吊销其他设备；当前会话的 cookie 不动，用户不会被登出
    const token = readCookie(request, COOKIE_NAME)
    if (token) await deleteSessionsExcept(env, user.id, await sha256Hex(token))

    return json({ ok: true }, { headers: setCookie })
  } catch (e) {
    return json({ error: e.message || '修改密码失败' }, { status: 500 })
  }
}
