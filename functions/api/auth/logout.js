// POST /api/auth/logout
import { endSession, clearCookie, json } from '../../lib/auth.js'

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, { status: 405 })
  try { await endSession(env, request) } catch {}
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } })
}
