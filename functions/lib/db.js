// Single data-access layer — ALL SQL lives here.
// 换数据库（PostgreSQL / MySQL / Turso / 本地 SQLite）只需改这一个文件。
// 方言约定：标准 SQLite；时间戳为 ISO-8601 TEXT，由应用层生成。

const SCHEMA_SQL = `
-- 旧版全局配置表（访客视角 / 登录播种来源），对应 d1/0001_init.sql；
-- 补进 ensureSchema 让全新 D1（新部署、fork、本地清库）无需手动跑迁移。
CREATE TABLE IF NOT EXISTS nav_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  pwd_hash   TEXT    NOT NULL,
  disabled   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token_hash TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS user_data (
  user_id    INTEGER NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS pwd_resets (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_pwd_resets_expiry ON pwd_resets(expires_at);
-- 内置导航站点库（自维护数据集，经 /api/builtin-sites/import 导入）
CREATE TABLE IF NOT EXISTS builtin_sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  icon        TEXT    DEFAULT '',
  icon_src    TEXT    DEFAULT '',
  description TEXT    DEFAULT '',
  rate        INTEGER DEFAULT 0,
  source_id   TEXT    DEFAULT '',
  updated_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS builtin_site_cats (
  site_id INTEGER NOT NULL,
  cat     TEXT    NOT NULL,
  PRIMARY KEY (site_id, cat)
);
CREATE INDEX IF NOT EXISTS idx_builtin_cats_cat ON builtin_site_cats(cat);
`;

let schemaReady = null // per-isolate promise cache

/** Idempotent bootstrap so git-push deploys work without running wrangler.
 *  Mirrors d1/0001/0002/0003 + in-place column migrations. */
export function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(
        SCHEMA_SQL.split(';')
          .map(s => s.trim())
          .filter(Boolean)
          .map(sql => env.DB.prepare(sql))
      )
      // 老库迁移：补 disabled 列（新库建表已含，报 duplicate column 属预期，静默吞掉）
      await env.DB.prepare("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0")
        .run().catch(() => {})
    })().catch(e => { schemaReady = null; throw e })
  }
  return schemaReady
}

export function nowISO() { return new Date().toISOString() }

// ---- users ----

export async function getUserByEmail(env, email) {
  return env.DB.prepare("SELECT id, email, pwd_hash, disabled, created_at FROM users WHERE email = ?")
    .bind(email).first()
}

export async function getUserById(env, id) {
  return env.DB.prepare("SELECT id, email, pwd_hash, disabled, created_at FROM users WHERE id = ?")
    .bind(id).first()
}

/** Returns new user id. Throws on duplicate email (UNIQUE). */
export async function createUser(env, email, pwdHash) {
  const res = await env.DB.prepare(
    "INSERT INTO users (email, pwd_hash, created_at) VALUES (?, ?, ?)"
  ).bind(email, pwdHash, nowISO()).run()
  return res.meta.last_row_id
}

// ---- sessions ----

export async function createSession(env, userId, tokenHash, expiresAt) {
  await env.DB.prepare(
    "INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(userId, tokenHash, nowISO(), expiresAt).run()
}

export async function getSessionByTokenHash(env, tokenHash) {
  return env.DB.prepare(
    `SELECT s.id, s.expires_at, s.user_id, u.email, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  ).bind(tokenHash).first()
}

export async function extendSession(env, sessionId, newExpiry) {
  await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
    .bind(newExpiry, sessionId).run()
}

export async function deleteSession(env, tokenHash) {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(tokenHash).run()
}

/** Opportunistic cleanup of expired rows (called on login). */
export async function purgeExpiredSessions(env) {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowISO()).run()
}

/** Revoke every session of the user except the given token hash (keep current device). */
export async function deleteSessionsExcept(env, userId, keepTokenHash) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
    .bind(userId, keepTokenHash).run()
}

/** Revoke ALL sessions of the user (used after admin/reset password changes). */
export async function deleteAllSessions(env, userId) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run()
}

// ---- user_data (per-user key/value, LWW by updated_at) ----

export async function getAllUserData(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT key, value, updated_at FROM user_data WHERE user_id = ?"
  ).bind(userId).all()
  return results || []
}

export async function getUserData(env, userId, key) {
  return env.DB.prepare(
    "SELECT value, updated_at FROM user_data WHERE user_id = ? AND key = ?"
  ).bind(userId, key).first()
}

/** Last-write-wins upsert: only writes when `updatedAt` is newer than stored. */
export async function upsertUserData(env, userId, key, value, updatedAt) {
  const cur = await getUserData(env, userId, key)
  if (cur && cur.updated_at >= updatedAt) return { written: false, updated_at: cur.updated_at }
  await env.DB.prepare(
    "INSERT OR REPLACE INTO user_data (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)"
  ).bind(userId, key, value, updatedAt).run()
  return { written: true, updated_at: updatedAt }
}

/** Unconditional write (used for explicit config saves — user intent wins). */
export async function setUserData(env, userId, key, value, updatedAt) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO user_data (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)"
  ).bind(userId, key, value, updatedAt).run()
}

// ---- account management ----

export async function updateUserPassword(env, userId, pwdHash) {
  await env.DB.prepare("UPDATE users SET pwd_hash = ? WHERE id = ?")
    .bind(pwdHash, userId).run()
}

/** Enable / disable a user account (0 = active, 1 = disabled). */
export async function setUserDisabled(env, userId, disabled) {
  await env.DB.prepare("UPDATE users SET disabled = ? WHERE id = ?")
    .bind(disabled ? 1 : 0, userId).run()
}

/** Atomic cascade delete — D1 batch runs as a single transaction:
 *  prefs, sessions and the user row all succeed or none do. */
export async function deleteUserCascade(env, userId) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_data WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ])
}

/** Admin listing — optional email substring search, counts via subqueries,
 *  never exposes pwd_hash. */
export async function listUsersWithStats(env, q = '') {
  const raw = String(q || '').trim().toLowerCase()
  const like = '%' + raw.replace(/[\\%_]/g, ch => '\\' + ch) + '%'
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, u.disabled,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
            (SELECT COUNT(*) FROM user_data d WHERE d.user_id = u.id) AS prefs
       FROM users u
      WHERE u.email LIKE ? ESCAPE '\\'
      ORDER BY u.id`
  ).bind(like).all()
  return results || []
}

// ---- builtin sites（内置导航站点库）----

export const BUILTIN_CATS = [
  'app', 'news', 'music', 'photos', 'shopping', 'social', 'sports',
  'life', 'games', 'education', 'tech', 'finance', 'read', 'others',
]

/** 批量 upsert：一行 JSON 数组经 json_each 展开写入（单语句 1 个绑定参数，
 *  绕开 D1 每语句 100 参数限制）。url 冲突时更新内容字段。 */
export async function upsertBuiltinSites(env, rows) {
  await env.DB.prepare(
    `INSERT INTO builtin_sites (url, name, icon, icon_src, description, rate, source_id, updated_at)
     SELECT je.value->>'$.url', je.value->>'$.name', je.value->>'$.icon',
            je.value->>'$.iconSrc', je.value->>'$.description',
            CAST(je.value->>'$.rate' AS INTEGER), je.value->>'$.sourceId', je.value->>'$.updatedAt'
       FROM json_each(?) AS je
     WHERE true
     ON CONFLICT(url) DO UPDATE SET
       name = excluded.name, icon = excluded.icon, icon_src = excluded.icon_src,
       description = excluded.description, rate = excluded.rate,
       source_id = excluded.source_id, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(rows)).run()
}

/** 同步分类关联：先清后插，仅对本次批次涉及的 url。 */
export async function replaceBuiltinCats(env, pairs) {
  const urls = [...new Set(pairs.map(p => p.url))]
  await env.DB.prepare("DELETE FROM builtin_site_cats WHERE site_id IN (SELECT id FROM builtin_sites WHERE url IN (SELECT je.value FROM json_each(?) AS je))")
    .bind(JSON.stringify(urls)).run()
  await env.DB.prepare(
    `INSERT OR IGNORE INTO builtin_site_cats (site_id, cat)
     SELECT s.id, je.value->>'$.cat' FROM json_each(?) je
       JOIN builtin_sites s ON s.url = je.value->>'$.url'`
  ).bind(JSON.stringify(pairs)).run()
}

export async function countBuiltinSites(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM builtin_sites").first()
  return row ? row.n : 0
}

/** 读接口：分类/关键词过滤 + rate 排序 + 分页。q 做 name/url 前后通配 LIKE。 */
export async function listBuiltinSites(env, { cat = '', q = '', page = 1, pageSize = 50 }) {
  const where = []
  const params = []
  if (cat) { where.push('s.id IN (SELECT site_id FROM builtin_site_cats WHERE cat = ?)'); params.push(cat) }
  if (q) {
    const like = '%' + String(q).replace(/[\\%_]/g, ch => '\\' + ch) + '%'
    where.push('(s.name LIKE ? ESCAPE \'\\\' OR s.url LIKE ? ESCAPE \'\\\')')
    params.push(like, like)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM builtin_sites s ${whereSql}`
  ).bind(...params).first()
  const total = countRow ? countRow.n : 0
  const limit = Math.min(100, Math.max(1, pageSize | 0 || 50))
  const offset = (Math.max(1, page | 0 || 1) - 1) * limit
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.url, s.icon, s.description, s.rate
       FROM builtin_sites s ${whereSql}
      ORDER BY s.rate DESC, s.name LIMIT ${limit} OFFSET ${offset}`
  ).bind(...params).all()
  const items = results || []
  // 批量补齐分类
  let catsBy = new Map()
  if (items.length) {
    const ids = items.map(i => i.id)
    const { results: catRows } = await env.DB.prepare(
      `SELECT site_id, cat FROM builtin_site_cats WHERE site_id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all()
    catsBy = new Map()
    for (const r of catRows || []) {
      if (!catsBy.has(r.site_id)) catsBy.set(r.site_id, [])
      catsBy.get(r.site_id).push(r.cat)
    }
  }
  return {
    total,
    page: Math.max(1, page | 0 || 1),
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
  await env.DB.prepare(
    "INSERT OR REPLACE INTO pwd_resets (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)"
  ).bind(email, codeHash, expiresAt).run()
}

export async function getPwdReset(env, email) {
  return env.DB.prepare("SELECT email, code_hash, expires_at, attempts FROM pwd_resets WHERE email = ?")
    .bind(email).first()
}

export async function bumpPwdResetAttempts(env, email, attempts) {
  await env.DB.prepare("UPDATE pwd_resets SET attempts = ? WHERE email = ?").bind(attempts, email).run()
}

export async function deletePwdReset(env, email) {
  await env.DB.prepare("DELETE FROM pwd_resets WHERE email = ?").bind(email).run()
}

export async function purgeExpiredPwdResets(env) {
  await env.DB.prepare("DELETE FROM pwd_resets WHERE expires_at < ?").bind(nowISO()).run()
}
