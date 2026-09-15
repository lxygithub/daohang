// POST /api/admin/reset-password  { userId, newPassword }
// 管理员为任意用户重置密码：无需原密码，重置后该用户全部会话下线。
import { ensureSchema, getUserById, updateUserPassword, deleteAllSessions } from '../../lib/db.js'
import { requireAdmin, hashPassword, sessionCookie, json, sameOrigin } from '../../lib/auth.js'

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, { status: 405 })
  if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })
  try {
    await ensureSchema(env)
    const sess = await requireAdmin(env, request)
    if (!sess) return json({ error: '需要管理员权限' }, { status: 403 })
    const setCookie = sess.renewToken ? { 'Set-Cookie': sessionCookie(sess.renewToken) } : {}

    const body = await request.json().catch(() => ({}))
    const userId = Number(body.userId)
    const newPassword = String(body.newPassword || '')
    if (!Number.isInteger(userId) || userId <= 0) return json({ error: '参数错误' }, { status: 400 })
    if (newPassword.length < 6 || newPassword.length > 128) {
      return json({ error: '新密码长度需在 6-128 位之间' }, { status: 400 })
    }

    const user = await getUserById(env, userId)
    if (!user) return json({ error: '用户不存在' }, { status: 404 })

    await updateUserPassword(env, user.id, await hashPassword(newPassword))
    await deleteAllSessions(env, user.id)
    return json({ ok: true, message: `已重置 ${user.email} 的密码，该用户全部设备已下线` }, { headers: setCookie })
  } catch (e) {
    return json({ error: e.message || '重置失败' }, { status: 500 })
  }
}
