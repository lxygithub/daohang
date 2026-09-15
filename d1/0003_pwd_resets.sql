-- 0003: 密码重置验证码（邮箱找回密码）
CREATE TABLE IF NOT EXISTS pwd_resets (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pwd_resets_expiry ON pwd_resets(expires_at);
