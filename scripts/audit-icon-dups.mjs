// 图标重复审计：把 rehost-state.jsonl 里已转存的图标从图床拉回本地，
// 按内容 SHA-1 分组 → 量化「图床上的重复图片」，同时落一份本地缓存
// （scripts/data/icon-cache/<sha1>.<ext>）作为去重索引 + 备份。
// 只读图床、零 D1 写入。用法：node scripts/audit-icon-dups.mjs [--conc=8]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const CACHE = path.join(DATA, 'icon-cache')
const STATE_FILE = path.join(DATA, 'rehost-state.jsonl')
const OUT = path.join(DATA, 'icon-dup-report.json')
const conc = parseInt(process.argv.find(a => a.startsWith('--conc='))?.slice(7) || '8', 10)

fs.mkdirSync(CACHE, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// 载入状态（src 唯一）
const recs = []
for (const line of fs.readFileSync(STATE_FILE, 'utf8').split('\n').filter(Boolean)) {
  try { const r = JSON.parse(line); if (r.ok && r.url) recs.push(r) } catch { }
}
console.log(`已转存记录 ${recs.length} 条，开始拉回哈希（并发 ${conc}）…`)

let idx = 0, done = 0, failN = 0
const results = [] // { src, url, hash, ext, bytes }
const started = Date.now()

async function worker() {
  while (idx < recs.length) {
    const rec = recs[idx++]
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 20000)
        const res = await fetch(rec.url, { signal: ctrl.signal })
        clearTimeout(t)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length < 50) throw new Error('过小')
        const hash = crypto.createHash('sha1').update(buf).digest('hex')
        const ct = (res.headers.get('content-type') || 'image/png').split(';')[0]
        const ext = (ct.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png'
        // 本地缓存：内容寻址，同内容只落一份
        const fp = path.join(CACHE, `${hash}.${ext}`)
        if (!fs.existsSync(fp)) fs.writeFileSync(fp, buf)
        results.push({ src: rec.src, url: rec.url, hash, ext, bytes: buf.length })
        ok = true
      } catch (e) {
        if (attempt === 2) { failN++; results.push({ src: rec.src, url: rec.url, err: e.message || 'fail' }) }
        else await sleep(1500 * (attempt + 1))
      }
    }
    done++
    if (done % 200 === 0) {
      const rate = done / ((Date.now() - started) / 1000)
      console.log(`进度 ${done}/${recs.length}｜${rate.toFixed(1)}/s｜失败 ${failN}`)
    }
  }
}
await Promise.all(Array.from({ length: conc }, worker))

// 分组统计
const okRows = results.filter(r => r.hash)
const byHash = new Map()
for (const r of okRows) {
  if (!byHash.has(r.hash)) byHash.set(r.hash, [])
  byHash.get(r.hash).push(r)
}
const dupGroups = [...byHash.entries()]
  .filter(([, g]) => g.length > 1)
  .sort((a, b) => b[1].length - a[1].length)
const wasted = okRows.length - byHash.size

const report = {
  generatedAt: new Date().toISOString(),
  totalRecords: recs.length,
  downloaded: okRows.length,
  failed: failN,
  uniqueContent: byHash.size,
  duplicateFiles: wasted,
  duplicateGroups: dupGroups.length,
  wastedPercent: okRows.length ? +(wasted / okRows.length * 100).toFixed(1) : 0,
  topGroups: dupGroups.slice(0, 20).map(([h, g]) => ({
    hash: h.slice(0, 10), count: g.length, ext: g[0].ext,
    sampleUrls: [...new Set(g.map(x => x.src))].slice(0, 3),
  })),
}
fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
// 内容寻址索引：<sha1> → 已在图床的外链（供 rehost-icons.mjs 跨源去重：同内容秒传复用）
const hashIndex = {}
for (const r of okRows) if (!hashIndex[r.hash]) hashIndex[r.hash] = r.url
fs.writeFileSync(path.join(DATA, 'icon-hash-index.json'), JSON.stringify(hashIndex))
console.log(`\n===== 审计结果 =====`)
console.log(`下载成功 ${okRows.length}/${recs.length}（失败 ${failN}）`)
console.log(`唯一内容（SHA-1）：${byHash.size}`)
console.log(`重复冗余文件：${wasted}（占 ${report.wastedPercent}%），重复组 ${dupGroups.length} 组`)
console.log(`最大重复组 TOP5：`)
for (const g of dupGroups.slice(0, 5)) console.log(`  ${g[0].slice(0, 10)} × ${g[1].length} 个文件｜例：${g[1][0].src.slice(0, 80)}`)
console.log(`报告 → ${OUT}`)
console.log(`本地缓存 → ${CACHE}（${fs.readdirSync(CACHE).length} 个文件）`)
