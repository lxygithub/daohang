// D1 直导：把 builtin-final.json 中图标已升级为图床外链的行，经 D1 REST API 直接 upsert。
// 背景：Pages secret 无法热生效、token 无 Pages 权限但有 D1 权限——复刻 import API 的
// json_each upsert 语句直写 D1（语义一致：ON CONFLICT(url) 全字段刷新 + updatedAt）。
// 不动 builtin_site_cats（分类未变化，省 ~4 万行写额度）。
//
// 用法：
//   CLOUDFLARE_API_TOKEN=xxx node scripts/d1-direct-import.mjs --check   # 预检：URL 匹配率/当前状态
//   CLOUDFLARE_API_TOKEN=xxx node scripts/d1-direct-import.mjs --run     # 分批 upsert + 对账
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const AID = 'd16192780cbd7ffa633f1e699a83dee8'
const DBID = 'cdcd3457-9c73-4cba-8daa-f97531949ab5'
const API = `https://api.cloudflare.com/client/v4/accounts/${AID}/d1/database/${DBID}/query`
const TOKEN = process.env.CLOUDFLARE_API_TOKEN
if (!TOKEN) { console.error('缺少 CLOUDFLARE_API_TOKEN 环境变量'); process.exit(1) }

// 与 functions/lib/db.js upsertBuiltinSites 逐字一致
const UPSERT_SQL = `INSERT INTO builtin_sites (url, name, icon, icon_src, description, rate, source_id, updated_at)
     SELECT je.value->>'$.url', je.value->>'$.name', je.value->>'$.icon',
            je.value->>'$.iconSrc', je.value->>'$.description',
            CAST(je.value->>'$.rate' AS INTEGER), je.value->>'$.sourceId', je.value->>'$.updatedAt'
       FROM json_each(?) AS je
     WHERE true
     ON CONFLICT(url) DO UPDATE SET
       name = excluded.name, icon = excluded.icon, icon_src = excluded.icon_src,
       description = excluded.description, rate = excluded.rate,
       source_id = excluded.source_id, updated_at = excluded.updated_at`

async function d1(sql, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params: params ?? [] }),
      })
      const j = await res.json()
      if (j.success) return j.result
      if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue }
      throw new Error('D1 error: ' + JSON.stringify(j.errors).slice(0, 200))
    } catch (e) {
      if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue }
      throw e
    }
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const final = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'builtin-final.json'), 'utf8'))
// delta 语义与 import-builtin.mjs --delta 一致：仅图标已升级为图床外链的行
const list = final.filter(s => String(s.icon || '').includes('/file/builtin-icons/'))
const now = new Date().toISOString()
const rows = list.map(s => ({
  url: s.url, name: s.name, icon: s.icon, iconSrc: s.iconSrc || '',
  description: s.description || '', rate: s.rate || 0, sourceId: s.sourceId || '', updatedAt: now,
}))
console.log(`final 共 ${final.length} 站，图床升级行 ${rows.length}（导入目标）`)

const mode = process.argv.includes('--run') ? 'run' : 'check'

if (mode === 'check') {
  const stat = await d1("SELECT COUNT(*) AS n FROM builtin_sites")
  console.log('D1 当前站点数:', stat[0]?.results?.[0]?.n)
  const bed = await d1("SELECT COUNT(*) AS n FROM builtin_sites WHERE icon LIKE '%/file/builtin-icons/%'")
  console.log('D1 已是图床外链:', bed[0]?.results?.[0]?.n)
  // URL 匹配率抽样（首/中/尾各 20 条）
  const sample = [rows.slice(0, 20), rows.slice(Math.floor(rows.length / 2), Math.floor(rows.length / 2) + 20), rows.slice(-20)].flat().map(r => r.url)
  const match = await d1(`SELECT COUNT(*) AS n FROM builtin_sites WHERE url IN (SELECT je.value FROM json_each(?) AS je)`, [JSON.stringify(sample)])
  console.log(`抽样 ${sample.length} 条 URL 在 D1 命中: ${match[0]?.results?.[0]?.n}`)
  // 差异明细：分批拉全量 D1 url 集合，本地求差（应为空集，否则 upsert 会插入新行）
  const all = []
  for (let off = 0; ; off += 5000) {
    const r = await d1(`SELECT url FROM builtin_sites ORDER BY id LIMIT 5000 OFFSET ${off}`)
    const part = r?.[0]?.results?.map(x => x.url) || []
    all.push(...part)
    if (part.length < 5000) break
  }
  const d1set = new Set(all)
  const missing = rows.map(r => r.url).filter(u => !d1set.has(u))
  console.log(missing.length ? `⚠️ ${missing.length} 条 url 不在 D1（将新增行），样例:` : '✅ 全部 url 已存在于 D1（纯 UPDATE，无新增行）')
  if (missing.length) console.log(missing.slice(0, 5))
  process.exit(0)
}

// ---- run：分批 upsert ----
const BATCH = 150
let done = 0, changes = 0
const started = Date.now()
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH)
  const r = await d1(UPSERT_SQL, [JSON.stringify(batch)])
  const c = r?.[0]?.meta?.changes ?? 0
  changes += c; done += batch.length
  if (done % 1500 === 0 || done >= rows.length) {
    const rate = done / ((Date.now() - started) / 1000)
    console.log(`进度 ${done}/${rows.length}｜累计写入行 ${changes}｜${rate.toFixed(0)} 行/s`)
  }
  await sleep(120) // 温和限速
}
console.log(`upsert 完成：${done} 行，实际写入 ${changes} 行`)

// ---- 对账 ----
const bed = await d1("SELECT COUNT(*) AS n FROM builtin_sites WHERE icon LIKE '%/file/builtin-icons/%'")
const total = await d1("SELECT COUNT(*) AS n FROM builtin_sites")
const bad = await d1("SELECT url, name FROM builtin_sites WHERE icon NOT LIKE '%/file/builtin-icons/%' LIMIT 15")
console.log(`对账：图床外链 ${bed[0]?.results?.[0]?.n}｜总站点 ${total[0]?.results?.[0]?.n}`)
if (bad[0]?.results?.length) console.log('仍非图床外链:', JSON.stringify(bad[0].results))
