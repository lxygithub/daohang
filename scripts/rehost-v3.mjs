// 图标转存 v3：hash 内容去重 + 断点续传 + 前台时间预算（沙箱禁后台进程，靠分段调用 + 状态文件续传）
//
// 子命令：
//   node scripts/rehost-v3.mjs status                          # 进度统计
//   node scripts/rehost-v3.mjs backfill-hash [--conc=10]       # 下载 state 已 ok 的图床 URL → sha1 → 恢复 hash 索引
//   node scripts/rehost-v3.mjs prefetch [--budget=540] [--conc=12]  # 下载 pending 源图标 → prefetch-icons/{sha1}.{ext}
//   node scripts/rehost-v3.mjs upload [--conc=6] [--budget=540] [--delay=0] [--max=0]  # hash 去重上传
//   node scripts/rehost-v3.mjs apply                           # 生成 builtin-final.json（失败回退原始直链）
//
// 断点续传文件（均在 scripts/data/）：
//   rehost-state.jsonl      {src, ok, url?, hash?, reused?, err?}  逐条落盘，重跑只跳过 ok:true
//   prefetch-src-map.json   {src: {h,e} | {err, perm?}}            源下载映射（h=sha1, e=扩展名）
//   icon-hash-index.json    {hash: url}                            内容→图床外链（跨轮去重核心）
//   prefetch-icons/         {sha1}.{ext}                           内容寻址本地缓存
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const ICONS_DIR = path.join(DATA, 'prefetch-icons')
const BASE = process.env.DH_BASE || 'https://daohang.ieoc.top'
const FOLDER = 'builtin-icons'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const STATE_FILE = path.join(DATA, 'rehost-state.jsonl')
const COOKIE_FILE = path.join(DATA, 'dh-cookie.txt')
const MAP_FILE = path.join(DATA, 'prefetch-src-map.json')
const INDEX_FILE = path.join(DATA, 'icon-hash-index.json')

fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(ICONS_DIR, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const sha1 = (buf) => crypto.createHash('sha1').update(Buffer.from(buf)).digest('hex')

// ---- 优雅停止：SIGTERM/SIGINT 后不再取新任务，做完当前项收尾 ----
let stopping = false
const onSig = () => { if (stopping) process.exit(0); stopping = true; console.log('\n[收尾] 完成当前项后退出…') }
process.on('SIGTERM', onSig); process.on('SIGINT', onSig)

function loadState() {
  const map = new Map() // src → 最后一条记录（后写覆盖先写）
  if (fs.existsSync(STATE_FILE)) {
    for (const line of fs.readFileSync(STATE_FILE, 'utf8').split('\n').filter(Boolean)) {
      try { const r = JSON.parse(line); map.set(r.src, r) } catch { }
    }
  }
  return map
}
const loadJson = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d

function sites() { return JSON.parse(fs.readFileSync(path.join(DATA, 'builtin-sites.json'), 'utf8')) }
function uniqueSrcs(list = sites()) { return [...new Set(list.map(s => s.iconSrc).filter(Boolean))] }

async function ensureCookie() {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim()
    const me = await fetch(BASE + '/api/auth/me', { headers: { Cookie: cookie } }).then(r => r.json()).catch(() => ({}))
    if (me?.user?.email || me?.email) { console.log('会话有效:', me.user?.email || me.email); return cookie }
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

async function fetchBin(url, timeoutMs) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return { err: 'HTTP ' + res.status }
    const ct = res.headers.get('content-type') || ''
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 3 * 1024 * 1024) return { err: '超过 3MB', perm: true }
    if (buf.byteLength < 50) return { err: '过小', perm: true }
    if (!ct.startsWith('image/') && !ct.includes('octet-stream')) return { err: '非图片: ' + ct.slice(0, 40), perm: true }
    const ext = (ct.split('/')[1] || 'png').split(';')[0].replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png'
    return { buf, type: ct.split(';')[0], ext }
  } catch (e) {
    return { err: e.name === 'AbortError' ? '下载超时' : (e.message || '下载失败') }
  } finally { clearTimeout(t) }
}

// ============ status ============
function cmdStatus() {
  const state = loadState()
  const map = loadJson(MAP_FILE, {})
  const idx = loadJson(INDEX_FILE, {})
  const srcs = uniqueSrcs()
  let ok = 0, fail = 0
  for (const s of srcs) { const r = state.get(s); if (r?.ok) ok++; else if (r) fail++ }
  const mapped = srcs.filter(s => map[s]?.h).length
  const mapErr = srcs.filter(s => map[s]?.err).length
  console.log(`唯一图标源 ${srcs.length}｜已上图床 ${ok}｜失败待重试 ${fail}｜未处理 ${srcs.length - ok - fail}`)
  console.log(`预取映射：成功 ${mapped}｜源不可用 ${mapErr}｜hash 索引 ${Object.keys(idx).length} 条`)
}

// ============ backfill-hash：从图床下载已传图标，恢复 hash→url 索引 ============
async function cmdBackfillHash(args) {
  const conc = parseInt(args.find(a => a.startsWith('--conc='))?.slice(7) || '10', 10)
  const state = loadState()
  const idx = loadJson(INDEX_FILE, {})
  const doneUrls = new Set(Object.values(idx))
  const jobs = [...state.values()].filter(r => r.ok && r.url && !doneUrls.has(r.url))
  console.log(`hash 索引已有 ${Object.keys(idx).length} 条，待回填 ${jobs.length} 条`)
  if (!jobs.length) return
  let idx0 = 0, okN = 0, failN = 0
  async function worker() {
    while (idx0 < jobs.length && !stopping) {
      const rec = jobs[idx0++]
      const f = await fetchBin(rec.url, 20000)
      if (f.buf) {
        idx[sha1(f.buf)] = rec.url
        okN++
        if (okN % 100 === 0) fs.writeFileSync(INDEX_FILE, JSON.stringify(idx))
      } else { failN++ }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx))
  console.log(`回填完成：成功 ${okN}｜失败 ${failN} → 索引共 ${Object.keys(idx).length} 条`)
}

// ============ prefetch：下载 pending 源图标 → 内容寻址缓存 ============
async function cmdPrefetch(args) {
  const budget = parseInt(args.find(a => a.startsWith('--budget='))?.slice(9) || '540', 10) * 1000
  const conc = parseInt(args.find(a => a.startsWith('--conc='))?.slice(7) || '12', 10)
  const deadline = Date.now() + budget
  const state = loadState()
  const map = loadJson(MAP_FILE, {})
  const todo = uniqueSrcs().filter(s => !state.get(s)?.ok && !map[s]?.h && !(map[s]?.err && map[s]?.perm))
  console.log(`待预取 ${todo.length}（预算 ${Math.round(budget / 1000)}s）`)
  if (!todo.length) return console.log('预取已全部完成')
  let idx0 = 0, okN = 0, failN = 0
  const started = Date.now()
  const flush = () => fs.writeFileSync(MAP_FILE, JSON.stringify(map))

  async function worker() {
    while (idx0 < todo.length && !stopping && Date.now() < deadline) {
      const src = todo[idx0++]
      const f = await fetchBin(src, 15000)
      if (f.buf) {
        const h = sha1(f.buf)
        const p = path.join(ICONS_DIR, `${h}.${f.ext}`)
        if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(f.buf))
        map[src] = { h, e: f.ext }
        okN++
      } else {
        map[src] = { err: f.err, ...(f.perm ? { perm: true } : {}) }
        failN++
      }
      if ((okN + failN) % 300 === 0) flush()
      if ((okN + failN) % 200 === 0) {
        const rate = (okN + failN) / ((Date.now() - started) / 1000)
        console.log(`预取 ${okN + failN}/${todo.length}｜成功 ${okN}｜失败 ${failN}｜${rate.toFixed(0)}/s`)
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  flush()
  const left = uniqueSrcs().filter(s => !state.get(s)?.ok && !map[s]?.h && !(map[s]?.err && map[s]?.perm)).length
  console.log(`预取收尾：本轮成功 ${okN}｜失败 ${failN}｜剩余 ${left}`)
}

// ============ upload：hash 去重上传 ============
async function cmdUpload(args) {
  const conc = parseInt(args.find(a => a.startsWith('--conc='))?.slice(7) || '6', 10)
  const delay = parseInt(args.find(a => a.startsWith('--delay='))?.slice(8) || '0', 10)
  const max = parseInt(args.find(a => a.startsWith('--max='))?.slice(6) || '0', 10)
  const budget = parseInt(args.find(a => a.startsWith('--budget='))?.slice(9) || '540', 10) * 1000
  const deadline = Date.now() + budget
  const state = loadState()
  const map = loadJson(MAP_FILE, {})
  const idx = loadJson(INDEX_FILE, {})
  // 只跳过 ok:true（失败行自动重试）；map 中 perm 失败的不再碰网络，落一条永久失败行
  let todo = uniqueSrcs().filter(s => !state.get(s)?.ok)
  const all = todo.length
  todo = todo.filter(s => map[s]?.h || map[s]?.err)
  todo = max ? todo.slice(0, max) : todo
  console.log(`待上传 ${todo.length}/${all}（其余缺预取映射，请先跑 prefetch）｜预算 ${Math.round(budget / 1000)}s｜并发 ${conc}｜间隔 ${delay}ms`)
  if (!todo.length) return
  const cookie = await ensureCookie()
  const stateFd = fs.openSync(STATE_FILE, 'a')
  const inflight = new Map() // hash → Promise<url|null>  同内容并发只传一次
  let idx0 = 0, okN = 0, reusedN = 0, failN = 0
  const started = Date.now()
  const record = (rec) => { try { fs.writeSync(stateFd, JSON.stringify(rec) + '\n') } catch { } }

  async function uploadOne(src, h, e) {
    if (inflight.has(h)) return inflight.get(h)
    const p = (async () => {
      const file = path.join(ICONS_DIR, `${h}.${e}`)
      if (!fs.existsSync(file)) return null
      const buf = fs.readFileSync(file)
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const fd = new FormData()
          fd.append('file', new Blob([buf], { type: `image/${e === 'jpg' ? 'jpeg' : e}` }), `${h}.${e}`)
          const ctrl = new AbortController()
          const t = setTimeout(() => ctrl.abort(), 40000)
          const res = await fetch(`${BASE}/api/upload?uploadFolder=${FOLDER}`, {
            method: 'POST', body: fd, headers: { Cookie: cookie }, signal: ctrl.signal,
          })
          clearTimeout(t)
          const body = await res.json().catch(() => ({}))
          if (res.ok && body.ok && body.url) return body.url
          var err = `上传 ${res.status}: ${String(body.error || '').slice(0, 80)}`
        } catch (e2) {
          err = e2.name === 'AbortError' ? '上传超时' : (e2.message || '上传失败')
        }
        if (attempt < 4) await sleep(2500 * (attempt + 1))
      }
      throw new Error(err)
    })()
    inflight.set(h, p)
    try { return await p } finally { inflight.delete(h) }
  }

  async function worker() {
    while (idx0 < todo.length && !stopping && Date.now() < deadline) {
      const src = todo[idx0++]
      const m = map[src]
      if (m?.err && m.perm) { record({ src, ok: false, err: m.err, perm: true }); failN++; continue }
      if (!m?.h) { continue } // 缺映射（预算耗尽没预取到），留给下轮
      const cached = idx[m.h]
      if (cached) { record({ src, ok: true, url: cached, hash: m.h, reused: true }); reusedN++; continue }
      try {
        const url = await uploadOne(src, m.h, m.e)
        if (url) { idx[m.h] = url; record({ src, ok: true, url, hash: m.h }); okN++ }
        else { record({ src, ok: false, err: '本地缓存缺失' }); failN++ }
      } catch (e) { record({ src, ok: false, err: e.message }); failN++ }
      if (delay) await sleep(delay)
      if ((okN + reusedN + failN) % 100 === 0) {
        const rate = (okN + reusedN + failN) / ((Date.now() - started) / 1000)
        const done = okN + reusedN + failN
        console.log(`上传 ${done}/${todo.length}｜新传 ${okN}｜hash 复用 ${reusedN}｜失败 ${failN}｜${rate.toFixed(1)}/s｜剩余约 ${Math.max(0, Math.round((todo.length - done) / rate / 60))} 分钟`)
        fs.writeFileSync(INDEX_FILE, JSON.stringify(idx))
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx))
  fs.closeSync(stateFd)
  console.log(`本轮收尾：新传 ${okN}｜复用 ${reusedN}｜失败 ${failN}（重跑自动续传，失败项会重试）`)
}

// ============ apply：生成 builtin-final.json ============
function cmdApply() {
  const list = sites()
  const state = loadState()
  let okN = 0, fallback = 0, miss = 0
  for (const s of list) {
    if (!s.iconSrc) { miss++; continue }
    const r = state.get(s.iconSrc)
    if (r?.ok && r.url) { s.icon = r.url; okN++ }
    else { s.icon = s.iconSrc; fallback++ }
  }
  fs.writeFileSync(path.join(DATA, 'builtin-final.json'), JSON.stringify(list))
  console.log(`图标落位：图床 ${okN}｜回退原始直链 ${fallback}｜无图标 ${miss} → data/builtin-final.json`)
}

const cmd = process.argv[2] || ''
const rest = process.argv.slice(3)
if (cmd === 'status') cmdStatus()
else if (cmd === 'backfill-hash') await cmdBackfillHash(rest)
else if (cmd === 'prefetch') await cmdPrefetch(rest)
else if (cmd === 'upload') await cmdUpload(rest)
else if (cmd === 'apply') cmdApply()
else { console.log('用法: node scripts/rehost-v3.mjs status|backfill-hash|prefetch|upload|apply'); process.exit(1) }
