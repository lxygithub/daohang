// GET  /api/user/prefs   → { data: { key: { v, t } }, serverTime }
// PUT  /api/user/prefs   { entries: [{ key, value, t }] }  — LWW upsert
//
// `key` 空间：layout/view/grid/font/search/hero/theme/engines/engine/sort_usage ...
// 'config'（服务列表+背景）不经此通道，由 /api/config 的会话路径管理。
import { ensureSchema, getAllUserData, upsertUserData } from '../../lib/db.js'
import { getSessionUser, sessionCookie, json, sameOrigin } from '../../lib/auth.js'

const MAX_KEY_LEN = 64
const MAX_VALUE_LEN = 512 * 1024 // 512KB per key — config with many services fits easily
const RESERVED_KEYS = new Set(['config'])

export async function onRequest(context) {
  const { request, env } = context
  try {
    await ensureSchema(env)
    const sess = await getSessionUser(env, request)
    if (!sess) return json({ error: '未登录' }, { status: 401 })
    const setCookie = sess.renewToken ? { 'Set-Cookie': sessionCookie(sess.renewToken) } : {}
    const userId = sess.user.id

    if (request.method === 'GET') {
      const rows = await getAllUserData(env, userId)
      const data = {}
      for (const r of rows) {
        if (RESERVED_KEYS.has(r.key)) continue
        data[r.key] = { v: r.value, t: Date.parse(r.updated_at) || 0 }
      }
      return json({ data, serverTime: Date.now() }, { headers: setCookie })
    }

    if (request.method === 'PUT') {
      if (!sameOrigin(request)) return json({ error: '非法来源' }, { status: 403 })
      const body = await request.json().catch(() => ({}))
      const entries = Array.isArray(body.entries) ? body.entries.slice(0, 32) : []
      const saved = {}, conflicts = {}
      for (const e of entries) {
        const key = String(e.key || '')
        const value = String(e.value ?? '')
        const t = Number(e.t)
        if (!key || key.length > MAX_KEY_LEN || RESERVED_KEYS.has(key)) continue
        if (value.length > MAX_VALUE_LEN) continue
        if (!Number.isFinite(t) || t <= 0) continue
        const iso = new Date(t).toISOString()
        const r = await upsertUserData(env, userId, key, value, iso)
        if (r.written) saved[key] = t
        else conflicts[key] = Date.parse(r.updated_at)
      }
      return json({ ok: true, saved, conflicts, serverTime: Date.now() }, { headers: setCookie })
    }

    return json({ error: 'Method Not Allowed' }, { status: 405 })
  } catch (e) {
    return json({ error: e.message || '同步失败' }, { status: 500 })
  }
}
