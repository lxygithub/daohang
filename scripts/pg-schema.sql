-- ============================================================
-- daohang 导航站 PostgreSQL schema（v2 · 2026-09 D1 → PG 迁移）
-- 执行身份：数据库 owner（应用运行时的 ro/rw 账号按设计无 DDL 权限，
-- 见 sql-gateway《使用与接入指南》坑 2）。
-- 执行位置：forgotit-postgres target 连接串指向的那个数据库。
--
-- 使用前把 __RO__ / __RW__ 替换为 /etc/sql-gateway/gateway.env 里
-- forgotit-postgres 的 readOnlyUrlEnv / readWriteUrlEnv 账号名，例如：
--   sed -i 's/__RO__/forgotit_ro/g; s/__RW__/forgotit_rw/g' pg-schema.sql
--   sudo -u postgres psql -d forgotit -f pg-schema.sql
--
-- 可重复执行（幂等）；表集中在独立 schema `daohang`，与 ForgotIt 业务表隔离。
-- ============================================================

CREATE SCHEMA IF NOT EXISTS daohang;

-- 旧版全局配置表（访客视角 / 登录播种来源；当前无代码读写，保留结构兼容）
CREATE TABLE IF NOT EXISTS daohang.nav_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS daohang.users (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      TEXT    NOT NULL UNIQUE,
  pwd_hash   TEXT    NOT NULL,
  disabled   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS daohang.sessions (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  token_hash TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS daohang.user_data (
  user_id    INTEGER NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS daohang.pwd_resets (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);

-- 内置导航站点库（自维护数据集，19,626 站经 d1-to-pg.mjs 搬迁）
CREATE TABLE IF NOT EXISTS daohang.builtin_sites (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url         TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  icon        TEXT    DEFAULT '',
  icon_src    TEXT    DEFAULT '',
  description TEXT    DEFAULT '',
  -- BIGINT 而非 INTEGER：D1/SQLite 动态类型，线上 rate 实测最大 901001003538，
  -- 超出 int4 上限（导入时会报 integer out of range）。
  rate        BIGINT DEFAULT 0,
  source_id   TEXT    DEFAULT '',
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS daohang.builtin_site_cats (
  site_id INTEGER NOT NULL,
  cat     TEXT    NOT NULL,
  PRIMARY KEY (site_id, cat)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user       ON daohang.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry     ON daohang.sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_pwd_resets_expiry   ON daohang.pwd_resets(expires_at);
CREATE INDEX IF NOT EXISTS idx_builtin_cats_cat    ON daohang.builtin_site_cats(cat);
CREATE INDEX IF NOT EXISTS idx_builtin_sites_rate  ON daohang.builtin_sites(rate DESC);

-- ---- 受限账号授权（网关 ro/rw 账号；owner 自身无需 grant）----
GRANT USAGE ON SCHEMA daohang TO __RO__, __RW__;

-- ro：只读业务表
GRANT SELECT ON ALL TABLES IN SCHEMA daohang TO __RO__;

-- rw：业务表增删改查 + 身份列序列 USAGE（指南要求：仅 DML，无任何 DDL/管理员权限）
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA daohang TO __RW__;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA daohang TO __RW__;

-- 以后在 daohang schema 新建的表/序列自动带上同样权限（owner 执行本文件即生效）
ALTER DEFAULT PRIVILEGES IN SCHEMA daohang GRANT SELECT ON TABLES TO __RO__;
ALTER DEFAULT PRIVILEGES IN SCHEMA daohang GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO __RW__;
ALTER DEFAULT PRIVILEGES IN SCHEMA daohang GRANT USAGE ON SEQUENCES TO __RW__;
