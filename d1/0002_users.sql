-- 用户账号 / 会话 / 每用户数据
-- 可移植性约定：
--   * 仅用标准 SQLite 方言（INTEGER AUTOINCREMENT / TEXT / 无 D1 专有特性）
--   * 时间戳一律 ISO-8601 TEXT（UTC），任何数据库通用
--   * 迁移到 PostgreSQL/MySQL 时：AUTOINCREMENT → SERIAL / AUTO_INCREMENT，
--     其余可直接执行；或使用 npm run db:import 自动转换
-- 本文件与 functions/lib/db.js 中 ensureSchema() 的 DDL 保持一致
-- （后者用于 Pages 部署时零配置自动建表，幂等）。

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,       -- 登录标识（小写存储）
  pwd_hash   TEXT    NOT NULL,              -- pbkdf2$iterations$saltHex$hashHex
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token_hash TEXT    NOT NULL UNIQUE,       -- sha256(原始token) hex，库泄露不可反推
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS user_data (
  user_id    INTEGER NOT NULL,
  key        TEXT    NOT NULL,              -- 'config' | 'layout' | 'grid' | 'font' | 'search' | 'hero' | 'theme' | 'engines' | 'engine' | ...
  value      TEXT    NOT NULL,              -- JSON 字符串或原始标量
  updated_at TEXT    NOT NULL,              -- ISO-8601，LWW 合并依据
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
