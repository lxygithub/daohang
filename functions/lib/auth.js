// Auth primitives — zero-dependency, Workers-native.
//   * 密码哈希：PBKDF2-SHA256（WebCrypto 内置，任何平台可复算）
//     迭代 25000：Workers 免费版有 ~10ms CPU/请求限制，取安全与限额的平衡点
//   * 会话：随机 256-bit token，仅存 sha256(token)；HttpOnly Cookie
//     → 数据库泄露也拿不到可用 token；可随时吊销（改密码/登出）

import { createSession, getSessionByTokenHash, extendSession, deleteSession, purgeExpiredSessions, nowISO } from './db.js'

export const COOKIE_NAME = 'nav_session'
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000      // 30 天
const RENEW_THRESHOLD_MS = 15 * 24 * 3600 * 1000  // 剩余 <15 天时滑动续期
const PBKDF2_ITERATIONS = 25000

const enc = new TextEncoder()
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(str) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(str)))
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ---- passwords ----

export async function hashPassword(password) {
  const salt = randomHex(16)
  const hash = await pbkdf2(password, salt)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, iterStr, salt, hash] = String(stored || '').split('$')
    if (algo !== 'pbkdf2' || !salt || !hash) return false
    const iter = Math.min(200000, Math.max(1000, parseInt(iterStr, 10) || 0))
    return timingSafeEqual(await pbkdf2(password, salt, iter), hash)
  } catch { return false }
}

async function pbkdf2(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)))
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return hex(bits)
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
export { timingSafeEqual }

// ---- sessions ----

export async function startSession(env, userId) {
  const token = randomHex(32) // 256-bit
  await createSession(env, userId, await sha256Hex(token), new Date(Date.now() + SESSION_TTL_MS).toISOString())
  await purgeExpiredSessions(env).catch(() => {})
  return token
}

/** Resolve the caller's session. Returns { user, renewToken } or null.
 *  renewToken is set when the sliding window renewed the expiry —
 *  the endpoint should re-send the cookie. */
export async function getSessionUser(env, request) {
  const token = readCookie(request, COOKIE_NAME)
  if (!token) return null
  const row = await getSessionByTokenHash(env, await sha256Hex(token))
  if (!row) return null
  if (row.disabled) { // 账号被禁用 → 会话即刻作废（全端下线）
    await deleteSession(env, await sha256Hex(token))
    return null
  }
  const expires = Date.parse(row.expires_at)
  if (!expires || expires < Date.now()) { await deleteSession(env, await sha256Hex(token)); return null }
  let renewToken = null
  if (expires - Date.now() < RENEW_THRESHOLD_MS) {
    await extendSession(env, row.id, new Date(Date.now() + SESSION_TTL_MS).toISOString())
    renewToken = token
  }
  return { user: { id: row.user_id, email: row.email }, renewToken }
}

export async function endSession(env, request) {
  const token = readCookie(request, COOKIE_NAME)
  if (token) await deleteSession(env, await sha256Hex(token))
}

// ---- cookies / responses ----

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

export function sessionCookie(token, maxAgeSec = SESSION_TTL_MS / 1000) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** CSRF hardening: mutating requests must be same-origin (Origin/Referer). */
export function sameOrigin(request) {
  const origin = request.headers.get('Origin') || request.headers.get('Referer') || ''
  if (!origin) return true // non-browser clients (curl etc.) — auth still required
  try { return new URL(origin).host === new URL(request.url).host } catch { return false }
}

// ---- naive in-memory rate limit (best effort per isolate) ----
// Cloudflare 免费版无持久限流原语；此处按 isolate 内存计数，
// 重启/换节点会重置 — 用于提高批量撞库成本，非严格保证。

const attempts = new Map() // key → [count, windowStart]
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

export function rateLimit(key, max = MAX_ATTEMPTS) {
  const now = Date.now()
  const [count, start] = attempts.get(key) || [0, now]
  if (now - start > WINDOW_MS) { attempts.set(key, [1, now]); return true }
  if (count >= max) return false
  attempts.set(key, [count + 1, start])
  return true
}

export function clientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 'local'
}

// ---- admin ----
// 管理员按邮箱判定：env.ADMIN_EMAILS（逗号分隔）优先，未配置时回落到内置默认。

export const DEFAULT_ADMIN_EMAIL = '594328762@qq.com'

export function adminEmails(env) {
  const raw = String(env?.ADMIN_EMAILS || '').trim()
  const list = raw
    ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [DEFAULT_ADMIN_EMAIL]
  return new Set(list)
}

export function isAdminEmail(env, email) {
  return adminEmails(env).has(String(email || '').trim().toLowerCase())
}

/** Session guard for admin endpoints. Returns sess or null. */
export async function requireAdmin(env, request) {
  const sess = await getSessionUser(env, request)
  if (!sess || !isAdminEmail(env, sess.user.email)) return null
  return sess
}

/** 6-digit numeric code (crypto random). */
export function randomCode() {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 1000000).padStart(6, '0')
}

export { nowISO }
