// POST /api/auth/forgot  { email }
// 忘记密码第一步：下发 6 位验证码邮件。
// 防枚举：邮箱不存在时返回与成功完全相同的响应；验证码只走邮件通道。
import { ensureSchema, getUserByEmail, upsertPwdReset, purgeExpiredPwdResets } from '../../lib/db.js'
import { sha256Hex, json, rateLimit, clientIP, sameOrigin, randomCode } from '../../lib/auth.js'
import { sendResetCode } from '../../lib/mailer.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const CODE_TTL_MS = 10 * 60 * 1000

const GENERIC_OK = {
  ok: true,
  message: '如果该邮箱已注册，验证码已发出（10 分钟内有效），请查收',
}

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, { status: 405 })
  if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })

  try {
    await ensureSchema(env)

    const body = await request.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return json({ error: '邮箱格式不正确' }, { status: 400 })

    if (!rateLimit(`forgot:${clientIP(request)}`, 5) || !rateLimit(`forgot:e:${email}`, 3)) {
      return json({ error: '请求过于频繁，请 15 分钟后再试' }, { status: 429 })
    }

    const user = await getUserByEmail(env, email)
    if (user && !user.disabled) { // 禁用账号不发码（对外响应保持一致，防枚举）
      const code = randomCode()
      await upsertPwdReset(env, email, await sha256Hex(code), new Date(Date.now() + CODE_TTL_MS).toISOString())
      purgeExpiredPwdResets(env).catch(() => {})
      await sendResetCode(env, email, code) // 失败会抛错 → 500，让用户重试而不是干等
    }

    return json(GENERIC_OK)
  } catch (e) {
    return json({ error: e.message || '发送失败，请稍后再试' }, { status: 500 })
  }
}
