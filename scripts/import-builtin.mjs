// 内置站点库导入：data/builtin-final.json → /api/builtin-sites/import（upsert 幂等）。
// 密钥从 data/import-key.txt 读取（与部署时 wrangler.toml [vars] BUILTIN_IMPORT_KEY 一致）。
// 用法：node scripts/import-builtin.mjs [--limit=1000]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.DH_BASE || 'https://daohang.ieoc.top'
const KEY = (fs.readFileSync(path.join(DIR, 'data', 'import-key.txt'), 'utf8') || '').trim()
const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.slice(8) || '0', 10)

if (!KEY) { console.error('缺少 data/import-key.txt'); process.exit(1) }

const sites = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'builtin-final.json'), 'utf8'))
const list = limit ? sites.slice(0, limit) : sites
console.log(`导入 ${list.length}/${sites.length} 条 → ${BASE}`)

const CHUNK = 150
let done = 0, okN = 0, fail = 0
const started = Date.now()
for (let i = 0; i < list.length; i += CHUNK) {
  const chunk = list.slice(i, i + CHUNK)
  const res = await fetch(BASE + '/api/builtin-sites/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-import-key': KEY },
    body: JSON.stringify({ key: KEY, sites: chunk }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.ok && body.ok) { okN += body.accepted; done = body.total }
  else {
    fail += chunk.length
    console.log(`× 批次 ${i}-${i + chunk.length} 失败: ${res.status} ${JSON.stringify(body).slice(0, 160)}`)
  }
  if ((i / CHUNK) % 20 === 0) console.log(`  已提交 ${Math.min(i + CHUNK, list.length)}/${list.length}｜库内 ${done}`)
  await new Promise(r => setTimeout(r, 120))
}
console.log(`完成：接受 ${okN}，失败 ${fail}，库内共 ${done} 条（耗时 ${Math.round((Date.now() - started) / 1000)}s）`)
