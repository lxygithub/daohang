// 图标转存：inftab 图标 CDN → 下载 → 经 daohang /api/upload 代理上传自建图床
// （uploadFolder=builtin-icons）。断点续传：data/rehost-state.jsonl 记录 src→外链。
//
// 内容去重（防图床重复文件）:
//   下载后按 SHA-1 算内容哈希，命中 data/icon-hash-index.json（或历史状态）即"秒传"——
//   直接复用已有外链，不再上传；上传文件名用内容哈希（确定性），重试不会产生新名字。
//   同时落一份本地缓存 data/icon-cache/<sha1>.<ext>（备份 + 去重索引，--no-cache 关闭）。
//
// 全局限流（防把图床打崩——图床是 CF Worker + TG 存储，高频写入会触发防护 502/1102）:
//   ① 全局节流：任意两次上传间隔 ≥ minGap（默认 150ms，硬上界 ≈6.6 次/秒，与并发数无关）
//   ② 自适应冷却：任一请求遇 502/1102/429，全员暂停（指数退避 2/4/8/16/30s），连续成功才解除
//   ③ 默认并发降到 6，每 worker 每项后再默认隔 100ms
//
// 用法：
//   node scripts/rehost-icons.mjs upload [--conc=6] [--max=2000] [--delay=100] [--no-cache]
//   node scripts/rehost-icons.mjs apply                             # 把转存结果写回 → data/builtin-final.json
// 前置：crawl-inftab.mjs merge 已产出 data/builtin-sites.json
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const BASE = process.env.DH_BASE || 'https://daohang.ieoc.top'
const FOLDER = 'builtin-icons'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const STATE_FILE = path.join(DATA, 'rehost-state.jsonl')
const COOKIE_FILE = path.join(DATA, 'dh-cookie.txt')
const CACHE_DIR = path.join(DATA, 'icon-cache')
const HASH_INDEX_FILE = path.join(DATA, 'icon-hash-index.json')

fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(CACHE_DIR, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 全局限流器 ────────────────────────────────────────────────
const MIN_GAP_MS = parseInt(process.env.REHOST_GAP || '150', 10)   // 相邻上传最小间隔
let nextSlot = 0          // 全局下一个可上传时刻
let cooldownUntil = 0     // 全员冷却截止时刻
let consecBedFails = 0    // 连续图床错误数（成功清零）

/** 上传前调用：全局节流 + 冷却等待（串行发放时段，与并发数无关） */
async function rateGate() {
  for (;;) {
    const now = Date.now()
    const wait = Math.max(nextSlot - now, cooldownUntil - now, 0)
    if (!wait) break
    await sleep(wait) // 只睡不发牌；时段统一由退出路径认领
  }
  nextSlot = Math.max(Date.now(), nextSlot) + MIN_GAP_MS
}

/** 图床限流信号（502/1102/429）→ 全员指数退避冷却 */
function noteBedError(status) {
  consecBedFails++
  const ms = Math.min(30000, 2000 * 2 ** Math.min(consecBedFails - 1, 4))
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms)
  console.warn(`⚠ 图床限流信号 ${status}：全员冷却 ${(cooldownUntil - Date.now()) / 1000 | 0}s（连续错误 ${consecBedFails}）`)
}
function noteBedOk() { consecBedFails = 0 }

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
    // 校验会话仍有效：401=真失效（重新注册）；网络错误/5xx=临时故障（重试，别误判）
    // 注意 /api/auth/me 返回扁平结构 {ok,email,userId}，不是 {user:{email}}
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(BASE + '/api/auth/me', { headers: { Cookie: cookie } })
        if (res.ok) {
          const me = await res.json().catch(() => ({}))
          const email = me?.user?.email || me?.email
          if (email) { console.log('会话有效:', email); return cookie }
        } else if (res.status === 401) {
          console.log('会话已失效，重新注册…')
          break
        }
      } catch { /* 网络错误 → 退避重试 */ }
      await sleep(1500 * (i + 1))
    }
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
    const ext = (ct.split('/')[1] || 'png').split(';')[0].replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png'
    // 内容哈希 + 确定性文件名：同内容永远同名（重试/重跑不再产生新文件）
    const hash = crypto.createHash('sha1').update(Buffer.from(buf)).digest('hex')
    return { buf, hash, ext, type: ct.split(';')[0], name: `icon_${hash.slice(0, 16)}.${ext}` }
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
    return { err: `上传 ${res.status}: ${String(body.error || '').slice(0, 80)}`, status: res.status }
  } catch (e) {
    return { err: e.name === 'AbortError' ? '上传超时' : (e.message || '上传失败') }
  } finally { clearTimeout(t) }
}

async function upload(args) {
  const conc = Math.min(12, parseInt(args.find(a => a.startsWith('--conc='))?.slice(7) || '6', 10))
  const max = parseInt(args.find(a => a.startsWith('--max='))?.slice(6) || '0', 10)
  const delay = parseInt(args.find(a => a.startsWith('--delay='))?.slice(8) || '100', 10) // 每 worker 每项后间隔 ms
  const noCache = args.includes('--no-cache')
  const sites = JSON.parse(fs.readFileSync(path.join(DATA, 'builtin-sites.json'), 'utf8'))
  const state = loadState()
  // 内容哈希索引：<sha1> → 图床外链。来源：审计产物 icon-hash-index.json + 带 hash 的历史状态行
  const hashIndex = new Map()
  if (fs.existsSync(HASH_INDEX_FILE)) {
    try { for (const [h, url] of Object.entries(JSON.parse(fs.readFileSync(HASH_INDEX_FILE, 'utf8')))) hashIndex.set(h, url) } catch { }
  }
  for (const r of state.values()) if (r.hash && r.url && !hashIndex.has(r.hash)) hashIndex.set(r.hash, r.url)
  const pending = [...new Set(sites.map(s => s.iconSrc).filter(Boolean))].filter(src => !state.has(src))
  console.log(`站点 ${sites.length}，唯一图标 ${[...new Set(sites.map(s => s.iconSrc).filter(Boolean))].length}，待转存 ${pending.length}${max ? `（本轮限 ${max}）` : ''}，内容索引 ${hashIndex.size} 项`)
  if (!pending.length) return console.log('全部转存完成')

  const cookie = await ensureCookie()
  const stateFd = fs.openSync(STATE_FILE, 'a')
  const queue = max ? pending.slice(0, max) : pending
  let idx = 0, okN = 0, failN = 0, reusedN = 0
  const started = Date.now()

  async function worker() {
    while (idx < queue.length) {
      const src = queue[idx++]
      let rec = null
      // 图床为 CF Worker + TG 存储，偶发 502/1102（flood-wait 周期性）——多次长退避重试
      for (let attempt = 0; attempt < 5 && !rec?.url; attempt++) {
        const f = await downloadIcon(src)
        if (f.err) { rec = { src, ok: false, err: f.err }; if (attempt < 4) { await sleep(2000 * (attempt + 1)); continue } break }
        // 内容去重：同内容已在图床 → 秒传复用外链，不再上传（防重复文件）
        const known = hashIndex.get(f.hash)
        if (known) {
          rec = { src, ok: true, url: known, reused: true, hash: f.hash }
          reusedN++
          break
        }
        await rateGate() // 全局限流：间隔发放 + 冷却等待
        const up = await uploadIcon(cookie, f)
        if (up.url) {
          rec = { src, ok: true, url: up.url, hash: f.hash }
          hashIndex.set(f.hash, up.url)
          noteBedOk()
          if (!noCache) { try { fs.writeFileSync(path.join(CACHE_DIR, `${f.hash}.${f.ext}`), Buffer.from(f.buf)) } catch { } }
        } else {
          rec = { src, ok: false, err: up.err }
          // 图床过载信号（502/1102/429/503）→ 全员指数退避，别硬怼
          if (up.status && [429, 502, 503].includes(up.status)) noteBedError(up.status)
        }
        if (!up.url && attempt < 4) await sleep(2500 * (attempt + 1))
      }
      fs.writeSync(stateFd, JSON.stringify(rec) + '\n')
      rec.ok ? okN++ : failN++
      if (delay) await sleep(delay)
      if ((okN + failN) % 50 === 0) {
        const rate = (okN + failN) / ((Date.now() - started) / 1000)
        console.log(`进度 ${okN + failN}/${queue.length}｜成功 ${okN}（复用 ${reusedN}）｜失败 ${failN}｜${rate.toFixed(1)}/s｜剩余约 ${Math.round((queue.length - okN - failN) / rate / 60)} 分钟`)
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  fs.closeSync(stateFd)
  // 索引回写：新增的 hash→url 供下次启动即知（秒传判断无需重新上传验证）
  fs.writeFileSync(HASH_INDEX_FILE, JSON.stringify(Object.fromEntries(hashIndex)))
  console.log(`本轮完成：成功 ${okN}（其中秒传复用 ${reusedN}），失败 ${failN}`)
  if (failN) {
    console.log('注意：失败项已记为 ok:false，重跑不会自动重试它们。若需重试失败项，先剔除失败行再跑：')
    console.log(`  grep -v '"ok":false' "${STATE_FILE}" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "${STATE_FILE}"`)
  }
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
