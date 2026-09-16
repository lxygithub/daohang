// 预下载待转存图标（沙箱网络可靠，用户本地可能连不动 inftab CDN）：
// 把 rehost-state 里尚未完成的唯一图标源全部下载到 scripts/data/prefetch-icons/<sha1>.<ext>，
// 并生成 src → {h:sha1, e:ext} 映射 prefetch-src-map.json（本地脚本按映射取文件，不再碰源 CDN）。
// 失败项记录在映射里（{err}），本地脚本运行时再回退从 CDN 下载。只读源 CDN，零 D1/零图床。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const OUT_DIR = path.join(DATA, 'prefetch-icons')
const MAP_FILE = path.join(DATA, 'prefetch-src-map.json')
const STATE_FILE = path.join(DATA, 'rehost-state.jsonl')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const conc = parseInt(process.argv.find(a => a.startsWith('--conc='))?.slice(7) || '10', 10)

fs.mkdirSync(OUT_DIR, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const sites = JSON.parse(fs.readFileSync(path.join(DATA, 'builtin-sites.json'), 'utf8'))
const state = new Map()
for (const line of fs.readFileSync(STATE_FILE, 'utf8').split('\n').filter(Boolean)) {
  try { const r = JSON.parse(line); state.set(r.src, r) } catch { }
}
// 已完成（含失败记录）的源不需要预下载
const pending = [...new Set(sites.map(s => s.iconSrc).filter(Boolean))].filter(src => !state.has(src))
// 断点：已有映射的源跳过（重跑续传）
let map = {}
if (fs.existsSync(MAP_FILE)) {
  try { map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) } catch { }
}
const queue = pending.filter(src => !map[src])
console.log(`站点 ${sites.length}｜唯一源 ${new Set(sites.map(s => s.iconSrc).filter(Boolean)).size}｜已完成 ${state.size}｜待预下载 ${queue.length}/${pending.length}`)

let idx = 0, okN = 0, failN = 0, skipN = 0
const started = Date.now()

async function fetchOne(src) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(src, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return { err: 'HTTP ' + res.status }
    const ct = res.headers.get('content-type') || ''
    const buf = await res.arrayBuffer()
    if (!ct.startsWith('image/') && !ct.includes('octet-stream')) return { err: '非图片: ' + ct.slice(0, 40) }
    if (buf.byteLength > 3 * 1024 * 1024) return { err: '超过 3MB' }
    if (buf.byteLength < 50) return { err: '过小' }
    const ext = (ct.split('/')[1] || 'png').split(';')[0].replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png'
    const hash = crypto.createHash('sha1').update(Buffer.from(buf)).digest('hex')
    const fp = path.join(OUT_DIR, `${hash}.${ext}`)
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, buf)
    return { h: hash, e: ext }
  } catch (e) {
    return { err: e.name === 'AbortError' ? '下载超时' : (e.message || '下载失败') }
  } finally { clearTimeout(t) }
}

async function worker() {
  while (idx < queue.length) {
    const src = queue[idx++]
    let r = null
    for (let attempt = 0; attempt < 3 && !r; attempt++) {
      r = await fetchOne(src)
      if (r.err && attempt < 2) { r = null; await sleep(1500 * (attempt + 1)) }
    }
    map[src] = r
    r.err ? failN++ : okN++
    if ((okN + failN) % 200 === 0) {
      const rate = (okN + failN) / ((Date.now() - started) / 1000)
      console.log(`进度 ${okN + failN}/${queue.length}｜成功 ${okN}｜失败 ${failN}｜${rate.toFixed(1)}/s｜剩余约 ${Math.round((queue.length - okN - failN) / rate / 60)} 分钟`)
      fs.writeFileSync(MAP_FILE, JSON.stringify(map)) // 中途落盘，断点续传
    }
  }
}
await Promise.all(Array.from({ length: conc }, worker))
fs.writeFileSync(MAP_FILE, JSON.stringify(map))
const files = fs.readdirSync(OUT_DIR).length
console.log(`预下载完成：成功 ${okN}（唯一内容文件 ${files}），失败 ${failN} → ${MAP_FILE}`)
