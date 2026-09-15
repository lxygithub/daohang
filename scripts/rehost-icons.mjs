// 图标转存：inftab 图标 CDN → 下载 → 经 daohang /api/upload 代理上传自建图床
// （uploadFolder=builtin-icons）。断点续传：data/rehost-state.jsonl 记录 src→外链。
//
// 用法：
//   node scripts/rehost-icons.mjs upload [--conc=12] [--max=2000]   # 转存（可反复跑直到全部完成）
//   node scripts/rehost-icons.mjs apply                             # 把转存结果写回 → data/builtin-final.json
// 前置：crawl-inftab.mjs merge 已产出 data/builtin-sites.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const BASE = process.env.DH_BASE || 'https://daohang.ieoc.top'
const FOLDER = 'builtin-icons'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const STATE_FILE = path.join(DATA, 'rehost-state.jsonl')
const COOKIE_FILE = path.join(DATA, 'dh-cookie.txt')

fs.mkdirSync(DATA, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function loadState() {
  const map = new Map()
  if (fs.existsSync(STATE_FILE)) {
    for (const line of fs.readFileSync(STATE_FILE, 'utf8').split('\n').filter(Boolean)) {
      try { const r = JSON.parse(line); map.set(r.src, r) } catch { }
    }
  }
  return map
}

async function ensureCookie() {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim()
    // 校验会话仍有效
    const me = await fetch(BASE + '/api/auth/me', { headers: { Cookie: cookie } }).then(r => r.json()).catch(() => ({}))
    if (me?.user?.email) { console.log('会话有效:', me.user.email); return cookie }
    console.log('会话已失效，重新注册…')
  }
  const email = `rehost-${Date.now()}@test.dev`
  const password = 'Rhs' + Math.random().toString(36).slice(2, 12)
  const res = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) throw new Error('注册失败: ' + res.status + ' ' + (await res.text()).slice(0, 120))
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('nav_session='))
  if (!cookie) throw new Error('注册成功但未拿到会话 cookie')
  fs.writeFileSync(COOKIE_FILE, cookie)
  console.log('已注册服务账号:', email)
  return cookie
}

async function downloadIcon(src) {
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
    const ext = (ct.split('/')[1] || 'png').split(';')[0].replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '')
    return { buf, type: ct.split(';')[0], name: `icon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext || 'png'}` }
  } catch (e) {
    return { err: e.name === 'AbortError' ? '下载超时' : (e.message || '下载失败') }
  } finally { clearTimeout(t) }
}

async function uploadIcon(cookie, file) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 40000)
  try {
    const fd = new FormData()
    fd.append('file', new Blob([file.buf], { type: file.type }), file.name)
    const res = await fetch(`${BASE}/api/upload?uploadFolder=${FOLDER}`, {
      method: 'POST', body: fd, headers: { Cookie: cookie }, signal: ctrl.signal,
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.ok && body.url) return { url: body.url }
    return { err: `上传 ${res.status}: ${String(body.error || '').slice(0, 80)}` }
  } catch (e) {
    return { err: e.name === 'AbortError' ? '上传超时' : (e.message || '上传失败') }
  } finally { clearTimeout(t) }
}

async function upload(args) {
  const conc = parseInt(args.find(a => a.startsWith('--conc='))?.slice(7) || '12', 10)
  const max = parseInt(args.find(a => a.startsWith('--max='))?.slice(6) || '0', 10)
  const delay = parseInt(args.find(a => a.startsWith('--delay='))?.slice(8) || '0', 10) // 每 worker 每项后间隔 ms（防图床限流）
  const sites = JSON.parse(fs.readFileSync(path.join(DATA, 'builtin-sites.json'), 'utf8'))
  const state = loadState()
  const pending = [...new Set(sites.map(s => s.iconSrc).filter(Boolean))].filter(src => !state.has(src))
  console.log(`站点 ${sites.length}，唯一图标 ${[...new Set(sites.map(s => s.iconSrc).filter(Boolean))].length}，待转存 ${pending.length}${max ? `（本轮限 ${max}）` : ''}`)
  if (!pending.length) return console.log('全部转存完成')

  const cookie = await ensureCookie()
  const stateFd = fs.openSync(STATE_FILE, 'a')
  const queue = max ? pending.slice(0, max) : pending
  let idx = 0, okN = 0, failN = 0
  const started = Date.now()

  async function worker() {
    while (idx < queue.length) {
      const src = queue[idx++]
      let rec = null
      // 图床为 CF Worker + TG 存储，偶发 502/1102（flood-wait 周期性）——多次长退避重试
      for (let attempt = 0; attempt < 5 && !rec?.url; attempt++) {
        const f = await downloadIcon(src)
        if (f.err) { rec = { src, ok: false, err: f.err }; if (attempt < 4) { await sleep(2000 * (attempt + 1)); continue } break }
        const up = await uploadIcon(cookie, f)
        rec = up.url ? { src, ok: true, url: up.url } : { src, ok: false, err: up.err }
        if (!up.url && attempt < 4) await sleep(2500 * (attempt + 1))
      }
      fs.writeSync(stateFd, JSON.stringify(rec) + '\n')
      rec.ok ? okN++ : failN++
      if (delay) await sleep(delay)
      if ((okN + failN) % 50 === 0) {
        const rate = (okN + failN) / ((Date.now() - started) / 1000)
        console.log(`进度 ${okN + failN}/${queue.length}｜成功 ${okN}｜失败 ${failN}｜${rate.toFixed(1)}/s｜剩余约 ${Math.round((queue.length - okN - failN) / rate / 60)} 分钟`)
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  fs.closeSync(stateFd)
  console.log(`本轮完成：成功 ${okN}，失败 ${failN}（重跑本命令可继续/重试失败项）`)
}

async function apply() {
  const sites = JSON.parse(fs.readFileSync(path.join(DATA, 'builtin-sites.json'), 'utf8'))
  const state = loadState()
  let okN = 0, fallback = 0, miss = 0
  for (const s of sites) {
    if (!s.iconSrc) { miss++; continue }
    const r = state.get(s.iconSrc)
    if (r?.ok && r.url) { s.icon = r.url; okN++ }
    else { s.icon = s.iconSrc; fallback++ } // 转存失败 → 回退原始直链（可用性优先，防盗链失效由前端 no-referrer 兜底）
  }
  fs.writeFileSync(path.join(DATA, 'builtin-final.json'), JSON.stringify(sites))
  console.log(`图标落位：图床 ${okN}｜回退原始直链 ${fallback}｜无图标 ${miss} → data/builtin-final.json`)
}

const cmd = process.argv[2] || ''
if (cmd === 'upload') await upload(process.argv.slice(3))
else if (cmd === 'apply') await apply()
else { console.log('用法: node scripts/rehost-icons.mjs upload|apply'); process.exit(1) }
