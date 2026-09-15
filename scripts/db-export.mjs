#!/usr/bin/env node
// D1 数据库一键导出 — npm run db:export [-- --local]
//
// 产物（backups/ 目录，已 gitignore）：
//   daohang-<时间>.sql    标准 SQLite dump（wrangler d1 export）
//   daohang-<时间>.json   全表 JSON（通用格式，可导入任意数据库）
//
// 迁移到其他数据库：
//   SQLite  : sqlite3 new.db < daohang-xxx.sql
//   任意库  : npm run db:import -- --data daohang-xxx.json --to pg|mysql|sqlite
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DB = 'daohang'
const LOCAL = process.argv.includes('--local')
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
mkdirSync('backups', { recursive: true })

const base = LOCAL ? ['wrangler', 'd1', 'export', DB, '--local'] : ['wrangler', 'd1', 'export', DB, '--remote']
const sqlFile = join('backups', `${DB}-${stamp}.sql`)
console.log(`▶ Exporting SQL (${LOCAL ? 'local' : 'remote'}) → ${sqlFile}`)
execFileSync('npx', base.concat(['--output', sqlFile]), { stdio: 'inherit', shell: process.platform === 'win32' })

// JSON dump for cross-database portability
const TABLES = ['nav_config', 'users', 'sessions', 'user_data']
const dump = { exportedAt: new Date().toISOString(), database: DB, tables: {} }
for (const t of TABLES) {
  console.log(`▶ Dumping ${t} → JSON`)
  const cmd = ['wrangler', 'd1', 'execute', DB, '--json', '--command', `SELECT * FROM ${t}`]
  if (LOCAL) cmd.push('--local')
  const out = JSON.parse(execFileSync('npx', cmd, { shell: process.platform === 'win32' }).toString())
  // wrangler 输出为数组（每条语句一个结果），取有 results 的那段
  const seg = Array.isArray(out) ? out.find(x => Array.isArray(x?.results)) : out
  dump.tables[t] = seg?.results || []
}
const jsonFile = join('backups', `${DB}-${stamp}.json`)
writeFileSync(jsonFile, JSON.stringify(dump, null, 2))
console.log(`\n✔ 完成：\n  ${sqlFile}\n  ${jsonFile}`)
