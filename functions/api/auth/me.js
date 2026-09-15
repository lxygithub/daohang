// GET /api/auth/me — session probe for the frontend
import { ensureSchema } from '../../lib/db.js'
import { getSessionUser, sessionCookie, json } from '../../lib/auth.js'

export async function onRequest(context) {
  const { request, env } = context
  try {
    await ensureSchema(env)
    const sess = await getSessionUser(env, request)
    if (!sess) return json({ ok: false }, { status: 401 })
    const headers = sess.renewToken ? { 'Set-Cookie': sessionCookie(sess.renewToken) } : {}
    return json({ ok: true, email: sess.user.email, userId: sess.user.id }, { headers })
  } catch (e) {
    return json({ ok: false, error: e.message }, { status: 500 })
  }
}
