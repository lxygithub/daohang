// 图标转存·本地运行版：在你自己的电脑上把内置站点库图标上传到自建图床。
// 与沙箱版 (rehost-icons.mjs) 的区别：图标内容优先取本地 icons/ 目录（沙箱预下载好的），
// 取不到才回退源 CDN；其余逻辑（限流、内容去重、断点续传、秒传）完全一致。
//
// 上传链路：本机 → https://daohang.ieoc.top/api/upload（生产代理）→ 自建图床（TG 存储）。
// 不写 D1（cookie 有效期内）；账号由脚本自动注册一个 rehost-* 服务账号，无需手动登录。
//
// 用法（在本目录执行，需 Node.js 18+）：
//   node rehost-local.mjs status                 # 查看进度
//   node rehost-local.mjs upload                 # 转存（可反复跑，断点续传直到待转存 0）
//   node rehost-local.mjs upload --conc=6        # 并发（默认 6，上限 12；全局另有 150ms 间隔硬限流）
//   node rehost-local.mjs apply                  # 生成 data/builtin-final.json（全跑完后执行）
//
// ⚠️ 限流说明：脚本内置全局发牌（任意两次上传间隔 ≥150ms）+ 遇 502/1102/429 全员自动冷却
//    （指数退避 2→30s）。这是为了不把图床打崩，请勿大幅调高并发。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const ICONS = path.join(DIR, 'icons')
const BASE = process.env.DH_BASE || 'https://daohang.ieoc.top'
const FOLDER = 'builtin-icons'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const STATE_FILE = path.join(DATA, 'rehost-state.jsonl')
const COOKIE_FILE = path.join(DATA, 'dh-cookie.txt')
const HASH_INDEX_FILE = path.join(DATA, 'icon-hash-index.json')
const SRC_MAP_FILE = path.join(DATA, 'prefetch-src-map.json')

fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(ICONS, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 全局限流器（与沙箱版一致）────────────────────────────────
const MIN_GAP_MS = parseInt(process.env.REHOST_GAP || '150', 10)
let nextSlot = 0, cooldownUntil = 0, consecBedFails = 0
async function rateGate() {
  for (;;) {
    const now = Date.now()
    const wait = Math.max(nextSlot - now, cooldownUntil - now, 0)
    if (!wait) break
    await sleep(wait)
  }
  nextSlot = Math.max(Date.now(), nextSlot) + MIN_GAP_MS
}
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
    // 401=真失效重新注册；网络错误/5xx 退避重试。/api/auth/me 返回扁平 {ok,email,userId}
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

/** 取图标内容：优先本地预下载文件（src-map → icons/<sha1>.<ext>），回退源 CDN。 */
async function getContent(src, srcMap) {
  const m = srcMap[src]
  if (m && m.h) {
    const fp = path.join(ICONS, `${m.h}.${m.e}`)
    if (fs.existsSync(fp)) {
      const buf = fs.readFileSync(fp)
      return { buf, hash: m.h, ext: m.e, type: 'image/' + (m.e === 'jpg' ? 'jpeg' : m.e), name: `icon_${m.h.slice(0, 16)}.${m.e}` }
    }
  }
  // 回退：从源 CDN 下载
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
    try { fs.writeFileSync(path.join(ICONS, `${hash}.${ext}`), Buffer.from(buf)) } catch { }
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
  const delay = parseInt(args.find(a => a.startsWith('--delay='))?.slice(8) || '100', 10)
  const sites = JSON.parse(fs.readFileSync(path.join(DATA, 'builtin-sites.json'), 'utf8'))
  const state = loadState()
  let srcMap = {}
  if (fs.existsSync(SRC_MAP_FILE)) { try { srcMap = JSON.parse(fs.readFileSync(SRC_MAP_FILE, 'utf8')) } catch { } }
  const hashIndex = new Map()
  if (fs.existsSync(HASH_INDEX_FILE)) {
    try { for (const [h, url] of Object.entries(JSON.parse(fs.readFileSync(HASH_INDEX_FILE, 'utf8')))) hashIndex.set(h, url) } catch { }
  }
  for (const r of state.values()) if (r.hash && r.url && !hashIndex.has(r.hash)) hashIndex.set(r.hash, r.url)
  const pending = [...new Set(sites.map(s => s.iconSrc).filter(Boolean))].filter(src => !state.has(src))
  console.log(`站点 ${sites.length}，唯一图标 ${[...new Set(sites.map(s => s.iconSrc).filter(Boolean))].length}，待转存 ${pending.length}${max ? `（本轮限 ${max}）` : ''}，内容索引 ${hashIndex.size} 项 → ${BASE}`)
  if (!pending.length) return console.log('全部转存完成 ✔ 接着跑: node rehost-local.mjs apply')

  const cookie = await ensureCookie()
  const stateFd = fs.openSync(STATE_FILE, 'a')
  const queue = max ? pending.slice(0, max) : pending
  let idx = 0, okN = 0, failN = 0, reusedN = 0
  const started = Date.now()

  async function worker() {
    while (idx < queue.length) {
      const src = queue[idx++]
      let rec = null
      for (let attempt = 0; attempt < 5 && !rec?.url; attempt++) {
        const f = await getContent(src, srcMap)
        if (f.err) { rec = { src, ok: false, err: f.err }; if (attempt < 4) { await sleep(2000 * (attempt + 1)); continue } break }
        const known = hashIndex.get(f.hash)
        if (known) {
          rec = { src, ok: true, url: known, reused: true, hash: f.hash }
          reusedN++
          break
        }
        await rateGate()
        const up = await uploadIcon(cookie, f)
        if (up.url) {
          rec = { src, ok: true, url: up.url, hash: f.hash }
          hashIndex.set(f.hash, up.url)
          noteBedOk()
        } else {
          rec = { src, ok: false, err: up.err }
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
  fs.writeFileSync(HASH_INDEX_FILE, JSON.stringify(Object.fromEntries(hashIndex)))
  console.log(`本轮完成：成功 ${okN}（其中秒传复用 ${reusedN}），失败 ${failN}`)
  if (failN) {
    console.log('注意：失败项已记为 ok:false，重跑不会自动重试它们。若需重试失败项，先剔除失败行再跑：')
    console.log(`  node -e "const fs=require('fs');const p='${STATE_FILE}';fs.writeFileSync(p,fs.readFileSync(p,'utf8').split('\\n').filter(l=>l&&!l.includes('\\\"ok\\\":false')).join('\\n'))"`)
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
    else { s.icon = s.iconSrc; fallback++ }
  }
  fs.writeFileSync(path.join(DATA, 'builtin-final.json'), JSON.stringify(sites))
  console.log(`图标落位：图床 ${okN}｜回退原始直链 ${fallback}｜无图标 ${miss} → data/builtin-final.json`)
  console.log('下一步：把这个文件发回（或连同 data/rehost-state.jsonl 一起），后续做收尾差量导入。')
}

function status() {
  const sites = JSON.parse(fs.readFileSync(path.join(DATA, 'builtin-sites.json'), 'utf8'))
  const state = loadState()
  const total = new Set(sites.map(s => s.iconSrc).filter(Boolean)).size
  const ok = [...state.values()].filter(r => r.ok).length
  const fail = state.size - ok
  console.log(`唯一图标源 ${total}｜已转存成功 ${ok}（${(ok / total * 100).toFixed(1)}%）｜失败 ${fail}｜剩余 ${total - ok}`)
}

const cmd = process.argv[2] || ''
if (cmd === 'upload') await upload(process.argv.slice(3))
else if (cmd === 'apply') await apply()
else if (cmd === 'status') status()
else { console.log('用法: node rehost-local.mjs upload|apply|status'); process.exit(1) }
