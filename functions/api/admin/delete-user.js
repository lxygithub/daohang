// POST /api/admin/delete-user  { userId }
// 管理员删除用户：单事务级联清除偏好/会话/用户行。管理员账号（含自己）不可删。
import { ensureSchema, getUserById, deleteUserCascade } from '../../lib/db.js'
import { requireAdmin, isAdminEmail, sessionCookie, json, sameOrigin } from '../../lib/auth.js'

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
    if (!Number.isInteger(userId) || userId <= 0) return json({ error: '参数错误' }, { status: 400 })

    const user = await getUserById(env, userId)
    if (!user) return json({ error: '用户不存在' }, { status: 404 })
    if (isAdminEmail(env, user.email)) {
      return json({ error: '管理员账号不允许在此删除' }, { status: 403 })
    }

    await deleteUserCascade(env, user.id)
    return json({ ok: true, message: `已删除 ${user.email}` }, { headers: setCookie })
  } catch (e) {
    return json({ error: e.message || '删除失败' }, { status: 500 })
  }
}
