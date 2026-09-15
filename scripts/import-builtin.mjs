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
const delta = process.argv.includes('--delta')
// --delta：仅导入图标已升级为图床外链的行（D1 中这些行此前是原始直链，跳过未变化的行省写额度）
const list0 = delta ? sites.filter(s => s.icon.includes('/file/builtin-icons/')) : sites
const list = limit ? list0.slice(0, limit) : list0
console.log(`导入 ${list.length}/${sites.length} 条${delta ? '（差量：仅图床图标行）' : ''} → ${BASE}`)

// ── 写额度护栏 ──────────────────────────────────────────────
// D1 免费档每日 10 万行写入（UTC 零点重置 = 北京时间早 8 点）。行写入估算：
//   站点 upsert 1 行/站；分类先清后插 ≈ 2 行/站（首次导入免删 ≈ 1 行/站），取 3 行/站留余量。
// 估算 > 5 万行时拒绝执行，需显式 --force——防止重蹈 09-15 一天打满全日额度的覆辙。
const EST_PER_SITE = 3
const est = list.length * EST_PER_SITE
if (est > 50000 && !process.argv.includes('--force')) {
  console.error(`⛔ 预计行写入 ≈ ${est.toLocaleString()}（${list.length} 站 × ${EST_PER_SITE}）> 50,000，已拒绝执行。`)
  console.error('   D1 免费档每日仅 10 万行写入；当天若已跑过导入/测试，再跑大概率打满额度，写功能全挂到次日 UTC 零点。')
  console.error(`   确认额度充足后，加 --force 重跑：node scripts/import-builtin.mjs --force${delta ? ' --delta' : ''}${limit ? ` --limit=${limit}` : ''}`)
  process.exit(1)
}

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
