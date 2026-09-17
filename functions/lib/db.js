// Single data-access layer — ALL SQL lives here.  ← PostgreSQL / SQL Gateway 版
// 2026-09 起 daohang 数据库由 Cloudflare D1(SQLite) 迁至内网 PostgreSQL，
// 经 functions/lib/gateway.js → db-gateway.ieop.top 访问；表集中在独立 schema `daohang`。
// 函数签名与 D1 版完全一致，上层路由零改动。
// 约定：时间戳为 ISO-8601 TEXT（应用层生成）——与 D1 版语义一致，LWW 字符串比较零格式漂移。
//
// ⚠️ 指南坑 2：应用运行时禁止 DDL。建表/授权由数据库 owner 在服务器执行
//    scripts/pg-schema.sql；本文件的 ensureSchema 只做探测，缺表即给出明确指引。
import { gatewayQuery } from './gateway.js'

const SCHEMA = 'daohang'                 // PG schema，与 ForgotIt 业务表隔离
const T = (t) => `${SCHEMA}.${t}`        // 表引用
const CORE_TABLES = ['users', 'sessions', 'user_data', 'pwd_resets', 'builtin_sites', 'builtin_site_cats', 'nav_config']

function target(env) { return env.SQL_GATEWAY_TARGET || 'forgotit-postgres' }

/** 网关查询：返回 rows 数组（results[0].rows）。多语句请用 raw()。 */
async function q(env, mode, sql, params = []) {
  const r = await gatewayQuery(env, target(env), mode, [{ sql, params }])
  return r.results?.[0]?.rows ?? []
}

/** 单行或 null。 */
async function one(env, mode, sql, params = []) {
  return (await q(env, mode, sql, params))[0] ?? null
}

/** 多语句单请求（网关同一短事务，≤20 条）。返回每条的 rows。 */
async function raw(env, mode, statements) {
  const r = await gatewayQuery(env, target(env), mode, statements)
  return r.results ?? []
}

/** 大批量语句按 20 条/请求分批执行（跨批非事务；调用方须幂等）。 */
async function execBatch(env, mode, statements) {
  for (let i = 0; i < statements.length; i += 20) {
    await raw(env, mode, statements.slice(i, i + 20))
  }
}

// 协议限制：单条语句绑定参数 + JSON 请求体 ≤256KiB。行数据导入类调用按字节对半分块。
function chunkByBytes(rows, cap = 200 * 1024) {
  const out = []
  let cur = [], size = 2
  for (const row of rows) {
    const s = JSON.stringify(row).length + 1
    if (size + s > cap && cur.length) { out.push(cur); cur = []; size = 2 }
    cur.push(row); size += s
  }
  if (cur.length) out.push(cur)
  return out
}

let schemaReady = null // per-isolate promise cache

/** 探测 schema 就绪（不改库结构）。缺表时抛出带指引的错误。 */
export function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      const rows = await q(env, 'read-only',
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [SCHEMA])
      const have = new Set(rows.map(r => r.table_name))
      const missing = CORE_TABLES.filter(t => !have.has(t))
      if (missing.length) {
        throw new Error(
          `数据库缺表: ${missing.join(', ')} —— 请先在服务器以数据库 owner 执行 scripts/pg-schema.sql（见 DEPLOY.md「切换到 PostgreSQL」），应用运行时无建表权限`,
        )
      }
    })().catch(e => { schemaReady = null; throw e })
  }
  return schemaReady
}

export function nowISO() { return new Date().toISOString() }

// ---- users ----

export async function getUserByEmail(env, email) {
  return one(env, 'read-only',
    `SELECT id, email, pwd_hash, disabled, created_at FROM ${T('users')} WHERE email = $1`, [email])
}

export async function getUserById(env, id) {
  return one(env, 'read-only',
    `SELECT id, email, pwd_hash, disabled, created_at FROM ${T('users')} WHERE id = $1`, [id])
}

/** Returns new user id. Throws on duplicate email (UNIQUE). */
export async function createUser(env, email, pwdHash) {
  const row = await one(env, 'read-write',
    `INSERT INTO ${T('users')} (email, pwd_hash, created_at) VALUES ($1, $2, $3) RETURNING id`,
    [email, pwdHash, nowISO()])
  return row.id
}

// ---- sessions ----

export async function createSession(env, userId, tokenHash, expiresAt) {
  await q(env, 'read-write',
    `INSERT INTO ${T('sessions')} (user_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, nowISO(), expiresAt])
}

export async function getSessionByTokenHash(env, tokenHash) {
  return one(env, 'read-only',
    `SELECT s.id, s.expires_at, s.user_id, u.email, u.disabled
       FROM ${T('sessions')} s JOIN ${T('users')} u ON u.id = s.user_id
      WHERE s.token_hash = $1`, [tokenHash])
}

export async function extendSession(env, sessionId, newExpiry) {
  await q(env, 'read-write',
    `UPDATE ${T('sessions')} SET expires_at = $1 WHERE id = $2`, [newExpiry, sessionId])
}

export async function deleteSession(env, tokenHash) {
  await q(env, 'read-write', `DELETE FROM ${T('sessions')} WHERE token_hash = $1`, [tokenHash])
}

/** Opportunistic cleanup of expired rows (called on login). */
export async function purgeExpiredSessions(env) {
  await q(env, 'read-write', `DELETE FROM ${T('sessions')} WHERE expires_at < $1`, [nowISO()])
}

/** Revoke every session of the user except the given token hash (keep current device). */
export async function deleteSessionsExcept(env, userId, keepTokenHash) {
  await q(env, 'read-write',
    `DELETE FROM ${T('sessions')} WHERE user_id = $1 AND token_hash != $2`, [userId, keepTokenHash])
}

/** Revoke ALL sessions of the user (used after admin/reset password changes). */
export async function deleteAllSessions(env, userId) {
  await q(env, 'read-write', `DELETE FROM ${T('sessions')} WHERE user_id = $1`, [userId])
}

// ---- user_data (per-user key/value, LWW by updated_at) ----

export async function getAllUserData(env, userId) {
  return q(env, 'read-only',
    `SELECT key, value, updated_at FROM ${T('user_data')} WHERE user_id = $1`, [userId])
}

export async function getUserData(env, userId, key) {
  return one(env, 'read-only',
    `SELECT value, updated_at FROM ${T('user_data')} WHERE user_id = $1 AND key = $2`, [userId, key])
}

/** Last-write-wins upsert: only writes when `updatedAt` is newer than stored. */
export async function upsertUserData(env, userId, key, value, updatedAt) {
  const cur = await getUserData(env, userId, key)
  if (cur && cur.updated_at >= updatedAt) return { written: false, updated_at: cur.updated_at }
  await setUserData(env, userId, key, value, updatedAt)
  return { written: true, updated_at: updatedAt }
}

/** Unconditional write (used for explicit config saves — user intent wins). */
export async function setUserData(env, userId, key, value, updatedAt) {
  await q(env, 'read-write',
    `INSERT INTO ${T('user_data')} (user_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [userId, key, value, updatedAt])
}

// ---- account management ----

export async function updateUserPassword(env, userId, pwdHash) {
  await q(env, 'read-write', `UPDATE ${T('users')} SET pwd_hash = $1 WHERE id = $2`, [pwdHash, userId])
}

/** Enable / disable a user account (0 = active, 1 = disabled). */
export async function setUserDisabled(env, userId, disabled) {
  await q(env, 'read-write',
    `UPDATE ${T('users')} SET disabled = $1 WHERE id = $2`, [disabled ? 1 : 0, userId])
}

/** Atomic cascade delete — one gateway request runs all three DELETEs in a
 *  single short transaction: prefs, sessions and the user row all succeed or none do. */
export async function deleteUserCascade(env, userId) {
  await raw(env, 'read-write', [
    { sql: `DELETE FROM ${T('user_data')} WHERE user_id = $1`, params: [userId] },
    { sql: `DELETE FROM ${T('sessions')} WHERE user_id = $1`, params: [userId] },
    { sql: `DELETE FROM ${T('users')} WHERE id = $1`, params: [userId] },
  ])
}

/** Admin listing — optional email substring search, counts via subqueries,
 *  never exposes pwd_hash. */
export async function listUsersWithStats(env, qstr = '') {
  const rawQ = String(qstr || '').trim().toLowerCase()
  const like = '%' + rawQ.replace(/[\\%_]/g, ch => '\\' + ch) + '%'
  return q(env, 'read-only',
    `SELECT u.id, u.email, u.created_at, u.disabled,
            (SELECT COUNT(*) FROM ${T('sessions')} s WHERE s.user_id = u.id) AS sessions,
            (SELECT COUNT(*) FROM ${T('user_data')} d WHERE d.user_id = u.id) AS prefs
       FROM ${T('users')} u
      WHERE u.email LIKE $1 ESCAPE '\\'
      ORDER BY u.id`, [like])
}

// ---- builtin sites（内置导航站点库）----

export const BUILTIN_CATS = [
  'app', 'news', 'music', 'photos', 'shopping', 'social', 'sports',
  'life', 'games', 'education', 'tech', 'finance', 'read', 'others',
]

/** 批量 upsert：行数组经 jsonb_to_recordset 展开写入；url 冲突时更新内容字段。
 *  超过请求体上限自动分块（跨块非事务，upsert 幂等）。 */
export async function upsertBuiltinSites(env, rows) {
  if (!rows?.length) return
  const SQL = `INSERT INTO ${T('builtin_sites')} (url, name, icon, icon_src, description, rate, source_id, updated_at)
     SELECT x.url, x.name, x.icon, x."iconSrc", x."description",
            x.rate::bigint, x."sourceId", x."updatedAt"
       FROM jsonb_to_recordset($1::jsonb) AS x(url text, name text, icon text, "iconSrc" text, "description" text, rate text, "sourceId" text, "updatedAt" text)
     WHERE true
     ON CONFLICT (url) DO UPDATE SET
       name = EXCLUDED.name, icon = EXCLUDED.icon, icon_src = EXCLUDED.icon_src,
       description = EXCLUDED.description, rate = EXCLUDED.rate,
       source_id = EXCLUDED.source_id, updated_at = EXCLUDED.updated_at`
  for (const chunk of chunkByBytes(rows)) {
    await q(env, 'read-write', SQL, [JSON.stringify(chunk)])
  }
}

/** 同步分类关联：先清后插，仅对本次批次涉及的 url。 */
export async function replaceBuiltinCats(env, pairs) {
  if (!pairs?.length) return
  for (const chunk of chunkByBytes(pairs)) {
    await raw(env, 'read-write', [
      { sql: `DELETE FROM ${T('builtin_site_cats')} WHERE site_id IN (
                SELECT id FROM ${T('builtin_sites')} WHERE url IN (SELECT x FROM jsonb_array_elements_text($1::jsonb)))`,
        params: [JSON.stringify(chunk.map(p => p.url))] },
      { sql: `INSERT INTO ${T('builtin_site_cats')} (site_id, cat)
                SELECT s.id, x.cat FROM jsonb_to_recordset($1::jsonb) AS x(url text, cat text)
                  JOIN ${T('builtin_sites')} s ON s.url = x.url
                ON CONFLICT DO NOTHING`,
        params: [JSON.stringify(chunk)] },
    ])
  }
}

/** 仅更新图标列（图标外链差量升级专用）：每站 1 行写入，不触碰分类关联。
 *  rows: [{ url, icon, updatedAt }]；url 不存在时该语句写 0 行，天然幂等。 */
export async function updateBuiltinIcons(env, rows) {
  if (!rows?.length) return
  await execBatch(env, 'read-write',
    rows.map(r => ({
      sql: `UPDATE ${T('builtin_sites')} SET icon = $2, updated_at = $3 WHERE url = $1`,
      params: [r.url, r.icon, r.updatedAt],
    })))
}

export async function countBuiltinSites(env) {
  const row = await one(env, 'read-only', `SELECT COUNT(*)::int AS n FROM ${T('builtin_sites')}`)
  return row ? Number(row.n) : 0
}

/** 读接口：分类/关键词过滤 + rate 排序 + 分页。q 做 name/url 前后通配 LIKE。
 *  count 与数据页合并为一次网关往返（同一短事务）。 */
export async function listBuiltinSites(env, { cat = '', qstr = '', page = 1, pageSize = 50 }) {
  const where = []
  const params = []
  if (cat) { where.push(`s.id IN (SELECT site_id FROM ${T('builtin_site_cats')} WHERE cat = $${params.length + 1})`); params.push(cat) }
  if (qstr) {
    const like = '%' + String(qstr).replace(/[\\%_]/g, ch => '\\' + ch) + '%'
    where.push(`(s.name LIKE $${params.length + 1} ESCAPE '\\' OR s.url LIKE $${params.length + 2} ESCAPE '\\')`)
    params.push(like, like)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const limit = Math.min(100, Math.max(1, pageSize | 0 || 50))
  const pageNo = Math.max(1, page | 0 || 1)
  const offset = (pageNo - 1) * limit

  const [countRes, listRes] = await raw(env, 'read-only', [
    { sql: `SELECT COUNT(*)::int AS n FROM ${T('builtin_sites')} s ${whereSql}`, params },
    { sql: `SELECT s.id, s.name, s.url, s.icon, s.description, s.rate
              FROM ${T('builtin_sites')} s ${whereSql}
             ORDER BY s.rate DESC, s.name LIMIT ${limit} OFFSET ${offset}`, params },
  ])
  const total = countRes?.rows?.[0] ? Number(countRes.rows[0].n) : 0
  const items = listRes?.rows ?? []

  // 批量补齐分类（第二往返）
  let catsBy = new Map()
  if (items.length) {
    const ids = items.map(i => i.id)
    const cats = await q(env, 'read-only',
      `SELECT site_id, cat FROM ${T('builtin_site_cats')} WHERE site_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ids)
    for (const r of cats) {
      if (!catsBy.has(r.site_id)) catsBy.set(r.site_id, [])
      catsBy.get(r.site_id).push(r.cat)
    }
  }
  return {
    total,
    page: pageNo,
    pageSize: limit,
    items: items.map(i => ({
      name: i.name, url: i.url, icon: i.icon || '',
      description: i.description || '', rate: i.rate || 0,
      cats: catsBy.get(i.id) || [],
    })),
  }
}

// ---- password resets (email verification codes) ----

export async function upsertPwdReset(env, email, codeHash, expiresAt) {
  await q(env, 'read-write',
    `INSERT INTO ${T('pwd_resets')} (email, code_hash, expires_at, attempts) VALUES ($1, $2, $3, 0)
     ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
    [email, codeHash, expiresAt])
}

export async function getPwdReset(env, email) {
  return one(env, 'read-only',
    `SELECT email, code_hash, expires_at, attempts FROM ${T('pwd_resets')} WHERE email = $1`, [email])
}

export async function bumpPwdResetAttempts(env, email, attempts) {
  await q(env, 'read-write', `UPDATE ${T('pwd_resets')} SET attempts = $1 WHERE email = $2`, [attempts, email])
}

export async function deletePwdReset(env, email) {
  await q(env, 'read-write', `DELETE FROM ${T('pwd_resets')} WHERE email = $1`, [email])
}

export async function purgeExpiredPwdResets(env) {
  await q(env, 'read-write', `DELETE FROM ${T('pwd_resets')} WHERE expires_at < $1`, [nowISO()])
}
