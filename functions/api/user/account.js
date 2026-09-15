// DELETE /api/user/account  { currentPassword }
// 注销账号：验证密码 → 单事务级联删除 user_data / sessions / users → 清 cookie。
// 删除后邮箱即刻释放，可重新注册；本地浏览器数据不受影响，由前端自行处理。
// 管理员账号禁止注销（前端隐藏入口，服务端硬拒绝兜底）。
import { ensureSchema, getUserById, deleteUserCascade } from '../../lib/db.js'
import { getSessionUser, verifyPassword, clearCookie, json, sameOrigin, rateLimit, isAdminEmail } from '../../lib/auth.js'

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'DELETE') return json({ error: 'Method Not Allowed' }, { status: 405 })
  if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })

  try {
    await ensureSchema(env)
    const sess = await getSessionUser(env, request)
    if (!sess) return json({ error: '未登录' }, { status: 401 })

    if (isAdminEmail(env, sess.user.email)) {
      return json({ error: '管理员账号不可注销' }, { status: 403 })
    }

    if (!rateLimit(`del:${sess.user.id}`)) {
      return json({ error: '尝试过于频繁，请 15 分钟后再试' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const current = String(body.currentPassword || '')
    const user = await getUserById(env, sess.user.id)
    if (!user || !(await verifyPassword(current, user.pwd_hash))) {
      return json({ error: '密码不正确' }, { status: 403 })
    }

    await deleteUserCascade(env, user.id)
    return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } })
  } catch (e) {
    return json({ error: e.message || '注销失败' }, { status: 500 })
  }
}
