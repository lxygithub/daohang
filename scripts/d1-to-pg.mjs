#!/usr/bin/env node
// d1-to-pg.mjs — daohang 数据库 D1 → PostgreSQL 一次性搬迁
//
// 只读 D1（REST API，读操作不耗写额度）→ 生成 psql 可执行的数据 SQL：
//   CLOUDFLARE_API_TOKEN=xxx node scripts/d1-to-pg.mjs            # 生成 backups/daohang-pg-data.sql
//   CLOUDFLARE_API_TOKEN=xxx node scripts/d1-to-pg.mjs --check    # 只统计行数不生成
//
// 服务器侧执行顺序（见 DEPLOY.md「切换到 PostgreSQL」）：
//   1) owner 建表授权:  sed 替换 __RO__/__RW__ 后 psql -f pg-schema.sql
//   2) 导入数据:        psql -d <forgotit-postgres 所指库> -f daohang-pg-data.sql
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const AID = 'd16192780cbd7ffa633f1e699a83dee8'
const DBID = 'cdcd3457-9c73-4cba-8daa-f97531949ab5'
const API = `https://api.cloudflare.com/client/v4/accounts/${AID}/d1/database/${DBID}/query`
const TOKEN = process.env.CLOUDFLARE_API_TOKEN
if (!TOKEN) { console.error('缺少 CLOUDFLARE_API_TOKEN 环境变量'); process.exit(1) }

const CHECK = process.argv.includes('--check')
const SCHEMA = 'daohang'
const PAGE = 5000
// 迁移顺序即外键逻辑序；id 全部原样保留（builtin_site_cats.site_id 依赖它）
const TABLES = ['nav_config', 'users', 'sessions', 'user_data', 'pwd_resets', 'builtin_sites', 'builtin_site_cats']
const IDENTITY = ['users', 'sessions', 'builtin_sites'] // GENERATED ALWAYS AS IDENTITY，导入后需 setval

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function d1(sql, params = []) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      })
      const j = await res.json()
      if (j.success) return j.result[0]?.results ?? []
      if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue }
      throw new Error('D1 error: ' + JSON.stringify(j.errors).slice(0, 200))
    } catch (e) {
      if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue }
      throw e
    }
  }
}

const lit = (v) =>
  v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE')
  : `'${String(v).replace(/'/g, "''")}'`

async function dumpTable(t) {
  const all = []
  for (let off = 0; ; off += PAGE) {
    const rows = await d1(`SELECT * FROM ${t} LIMIT ${PAGE} OFFSET ${off}`)
    all.push(...rows)
    if (rows.length < PAGE) break
    process.stdout.write(`  ${t}: ${all.length}...\r`)
  }
  console.log(`  ${t.padEnd(18)} ${String(all.length).padStart(6)} 行`)
  return all
}

const counts = {}
const dump = {}
console.log(`▶ 读取 D1（只读，不耗写额度）`)
for (const t of TABLES) { dump[t] = await dumpTable(t); counts[t] = dump[t].length }

if (CHECK) { console.log('\n✔ 预检完成（--check 不生成 SQL）'); process.exit(0) }

console.log(`\n▶ 生成 PG 导入 SQL`)
const out = []
out.push(`-- daohang D1 → PG 数据搬迁（生成于 ${new Date().toISOString()}）`)
out.push(`-- 先执行 pg-schema.sql（建表+授权），再本文件。幂等：ON CONFLICT DO NOTHING。`)
out.push(`BEGIN;`)
for (const t of TABLES) {
  const rows = dump[t]
  if (!rows.length) { out.push(`-- ${t}: 空表`); continue }
  const cols = Object.keys(rows[0])
  const colList = cols.map(c => `"${c}"`).join(', ')
  const size = 500 // 行/语句
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size)
    const values = chunk.map(r => `(${cols.map(c => lit(r[c])).join(', ')})`).join(',\n  ')
    const override = IDENTITY.includes(t) ? ' OVERRIDING SYSTEM VALUE' : ''
    out.push(`INSERT INTO ${SCHEMA}.${t} (${colList})${override} VALUES\n  ${values}\nON CONFLICT DO NOTHING;`)
  }
}
for (const t of IDENTITY) {
  out.push(`SELECT setval(pg_get_serial_sequence('${SCHEMA}.${t}','id'), (SELECT COALESCE(MAX(id),1) FROM ${SCHEMA}.${t}));`)
}
out.push(`COMMIT;`)

const outFile = path.join(DIR, '..', 'backups', 'daohang-pg-data.sql')
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, out.join('\n') + '\n')
console.log(`\n✔ 完成 → ${outFile}`)
console.log(`  行数: ${JSON.stringify(counts)}`)
console.log(`  下一步：scp 到服务器后 psql -d <库> -f daohang-pg-data.sql`)
