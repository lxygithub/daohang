// Single data-access layer — ALL SQL lives here.
// 换数据库（PostgreSQL / MySQL / Turso / 本地 SQLite）只需改这一个文件。
// 方言约定：标准 SQLite；时间戳为 ISO-8601 TEXT，由应用层生成。

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  pwd_hash   TEXT    NOT NULL,
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
`;

let schemaReady = null // per-isolate promise cache

/** Idempotent bootstrap so git-push deploys work without running wrangler.
 *  Mirrors d1/0002_users.sql. */
export function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(
      SCHEMA_SQL.split(';')
        .map(s => s.trim())
        .filter(Boolean)
        .map(sql => env.DB.prepare(sql))
    ).catch(e => { schemaReady = null; throw e })
  }
  return schemaReady
}

export function nowISO() { return new Date().toISOString() }

// ---- users ----

export async function getUserByEmail(env, email) {
  return env.DB.prepare("SELECT id, email, pwd_hash, created_at FROM users WHERE email = ?")
    .bind(email).first()
}

export async function getUserById(env, id) {
  return env.DB.prepare("SELECT id, email, pwd_hash, created_at FROM users WHERE id = ?")
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
    `SELECT s.id, s.expires_at, s.user_id, u.email
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

/** Atomic cascade delete — D1 batch runs as a single transaction:
 *  prefs, sessions and the user row all succeed or none do. */
export async function deleteUserCascade(env, userId) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_data WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ])
}

/** Admin listing — counts via subqueries, never exposes pwd_hash. */
export async function listUsersWithStats(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.created_at,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
            (SELECT COUNT(*) FROM user_data d WHERE d.user_id = u.id) AS prefs
       FROM users u ORDER BY u.id`
  ).all()
  return results || []
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
