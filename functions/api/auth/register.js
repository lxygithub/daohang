// POST /api/auth/register  { email, password }
import { ensureSchema, getUserByEmail, createUser } from '../../lib/db.js'
import { hashPassword, startSession, sessionCookie, json, rateLimit, clientIP, sameOrigin } from '../../lib/auth.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, { status: 405 })
  if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })

  try {
    await ensureSchema(env)

    const body = await request.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')

    if (!rateLimit(`reg:${clientIP(request)}`, 5)) return json({ error: '尝试过于频繁，请稍后再试' }, { status: 429 })
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: '邮箱格式不正确' }, { status: 400 })
    if (password.length < 6 || password.length > 128) return json({ error: '密码长度需在 6-128 位之间' }, { status: 400 })

    if (await getUserByEmail(env, email)) return json({ error: '该邮箱已注册，请直接登录' }, { status: 409 })

    const userId = await createUser(env, email, await hashPassword(password))
    const token = await startSession(env, userId)
    return json({ ok: true, email }, { headers: { 'Set-Cookie': sessionCookie(token) } })
  } catch (e) {
    return json({ error: e.message || '注册失败' }, { status: 500 })
  }
}
