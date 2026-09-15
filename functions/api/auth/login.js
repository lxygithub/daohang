// POST /api/auth/login  { email, password }
import { ensureSchema, getUserByEmail, purgeExpiredSessions } from '../../lib/db.js'
import { hashPassword, verifyPassword, startSession, sessionCookie, json, rateLimit, clientIP, sameOrigin, isAdminEmail } from '../../lib/auth.js'

// Registration seeds nothing; login never reveals whether the account exists.
const GENERIC_FAIL = { ok: false, error: '邮箱或密码错误' }

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, { status: 405 })
  if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })

  try {
    await ensureSchema(env)

    const body = await request.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')

    if (!rateLimit(`login:${clientIP(request)}:${email}`)) {
      return json({ error: '尝试过于频繁，请 15 分钟后再试' }, { status: 429 })
    }

    const user = await getUserByEmail(env, email)
    if (!user || !(await verifyPassword(password, user.pwd_hash))) {
      // Burn comparable CPU on the missing-user path to blunt timing probes.
      if (!user) await hashPassword(password)
      return json(GENERIC_FAIL, { status: 403 })
    }
    if (user.disabled) {
      return json({ ok: false, error: '该账号已被禁用，请联系管理员' }, { status: 403 })
    }

    const token = await startSession(env, user.id)
    purgeExpiredSessions(env).catch(() => {})
    return json({ ok: true, email: user.email, isAdmin: isAdminEmail(env, user.email) }, { headers: { 'Set-Cookie': sessionCookie(token) } })
  } catch (e) {
    return json({ error: e.message || '登录失败' }, { status: 500 })
  }
}
