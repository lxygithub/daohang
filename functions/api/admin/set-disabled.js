// POST /api/admin/set-disabled  { userId, disabled }
// 管理员启用/禁用用户账号：
//   * 禁用 → 立即吊销该用户全部会话（全端下线），且无法再登录；
//     云端偏好数据保留，启用后原样恢复。
//   * 管理员账号（含自己）不可被禁用，避免误操作锁死管理入口。
import { ensureSchema, getUserById, setUserDisabled, deleteAllSessions } from '../../lib/db.js'
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
    const disabled = body.disabled ? 1 : 0
    if (!Number.isInteger(userId) || userId <= 0) return json({ error: '参数错误' }, { status: 400 })

    const user = await getUserById(env, userId)
    if (!user) return json({ error: '用户不存在' }, { status: 404 })
    if (isAdminEmail(env, user.email)) {
      return json({ error: '管理员账号不可被禁用' }, { status: 403 })
    }

    await setUserDisabled(env, user.id, disabled)
    if (disabled) await deleteAllSessions(env, user.id) // 禁用即全端下线

    return json({
      ok: true,
      message: disabled ? `已禁用 ${user.email}，该用户全部设备已下线` : `已启用 ${user.email}`,
    }, { headers: setCookie })
  } catch (e) {
    return json({ error: e.message || '操作失败' }, { status: 500 })
  }
}
