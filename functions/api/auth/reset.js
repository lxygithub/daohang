// POST /api/auth/reset  { email, code, newPassword }
// 忘记密码第二步：校验验证码 → 重置密码 → 吊销该用户全部会话。
import {
  ensureSchema, getUserByEmail, updateUserPassword, deleteAllSessions,
  getPwdReset, bumpPwdResetAttempts, deletePwdReset,
} from '../../lib/db.js'
import { sha256Hex, timingSafeEqual, hashPassword, json, rateLimit, clientIP, sameOrigin } from '../../lib/auth.js'

const MAX_ATTEMPTS = 5

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, { status: 405 })
  if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })

  try {
    await ensureSchema(env)

    if (!rateLimit(`reset:${clientIP(request)}`, 10)) {
      return json({ error: '尝试过于频繁，请 15 分钟后再试' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const code = String(body.code || '').trim()
    const newPassword = String(body.newPassword || '')
    if (newPassword.length < 6 || newPassword.length > 128) {
      return json({ error: '新密码长度需在 6-128 位之间' }, { status: 400 })
    }

    const row = await getPwdReset(env, email)
    if (!row) return json({ error: '请先获取验证码' }, { status: 400 })
    if (Date.parse(row.expires_at) < Date.now()) {
      await deletePwdReset(env, email)
      return json({ error: '验证码已过期，请重新获取' }, { status: 400 })
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await deletePwdReset(env, email)
      return json({ error: '错误次数过多，请重新获取验证码' }, { status: 429 })
    }

    if (!timingSafeEqual(await sha256Hex(code), row.code_hash)) {
      const attempts = row.attempts + 1
      if (attempts >= MAX_ATTEMPTS) await deletePwdReset(env, email)
      else await bumpPwdResetAttempts(env, email, attempts)
      return json({ error: `验证码不正确（还可尝试 ${MAX_ATTEMPTS - attempts} 次）` }, { status: 400 })
    }

    const user = await getUserByEmail(env, email)
    if (!user) {
      await deletePwdReset(env, email)
      return json({ error: '账号不存在' }, { status: 400 })
    }

    await updateUserPassword(env, user.id, await hashPassword(newPassword))
    await deleteAllSessions(env, user.id) // 密码重置 = 全设备下线
    await deletePwdReset(env, email)

    return json({ ok: true, message: '密码已重置，请使用新密码登录' })
  } catch (e) {
    return json({ error: e.message || '重置失败，请稍后再试' }, { status: 500 })
  }
}
