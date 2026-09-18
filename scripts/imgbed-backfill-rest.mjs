#!/usr/bin/env node
// 补完「站点库里图标还在外站」的最后一批：下载源图标 → 按内容 sha1 去重 → 上图床 → 落库。
//
// 背景：2026-09-17 的转存把 16,853/18,047 行换成了图床外链，剩 1,194 行仍指向
// Infinity New Tab 的两个 CDN（`infinitypro-img` / `infinityicon`）。这批从未进入
// 当时的 prefetch-src-map，所以既没有本地缓存也没有 hash 索引，得现下现传。
//
// 用法（两段式：先抓取+上传，再落库）：
//   # 1) 把待处理行从库里导出（只读）
//   docker exec -i forgotit-postgres psql -U forgotit -d forgotit -t -A \
//     -c "SELECT json_agg(json_build_object('id',id,'name',name,'url',url,'icon',icon)) \
//         FROM daohang.builtin_sites WHERE icon NOT LIKE 'https://img-bed.ieoc.top/%'" \
//     > scripts/data/pending-icons.json
//
//   # 2) 抓取并上传（需要 daohang 的登录 cookie；脚本可自动注册服务账号）
//   node scripts/imgbed-backfill-rest.mjs run [--conc=6] [--budget=540] [--dry-run]
//
//   # 3) 生成的 SQL 落库
//   psql -f scripts/data/backfill-rest.sql    （或 docker exec -i ... psql < 该文件）
//
// 兜底（源图标本身已死，如 Infinity 的 `/undefined` 占位与失效的 user-share-icon）：
// 改成用站点自己的 favicon 当源——调 daohang 的 `/api/favicon?url=<站点地址>` 拿候选，
// 下载后同样上图床；连 favicon 都没有的行把 icon 置空，交给前端首字图标兜底。
//
//   node scripts/imgbed-backfill-rest.mjs favicon [--conc=3] [--budget=300]
//
// 产物（scripts/data/，均在 .gitignore 内）：
//   backfill-rest-map.json   id → {src, hash, url} | {src, err}   逐条落盘，可反复续跑
//   backfill-rest.sql        最终 UPDATE 语句（只改 icon，不动 icon_src）
//   backfill-icons/          下载到的源图（内容寻址，便于排错）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const PENDING = path.join(DATA, 'pending-icons.json')
const MAP_FILE = path.join(DATA, 'backfill-rest-map.json')
const SQL_FILE = path.join(DATA, 'backfill-rest.sql')
const ICONS_DIR = path.join(DATA, 'backfill-icons')
const INDEX_FILE = path.join(DATA, 'icon-hash-index.json')

const BASE = process.env.DH_BASE || 'https://daohang.ieop.top'
const FOLDER = 'builtin-icons'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'

const args = process.argv.slice(2)
const cmd = args[0] || 'run'
const getArg = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d
const dryRun = args.includes('--dry-run')

fs.mkdirSync(ICONS_DIR, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha1 = (buf) => crypto.createHash('sha1').update(Buffer.from(buf)).digest('hex')
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d)

// ── 登录：优先用 DH_COOKIE，其次复用/新建服务账号 ─────────────────────
async function ensureCookie() {
  const envCookie = String(process.env.DH_COOKIE || '').trim()
  if (envCookie) return envCookie
  const email = process.env.DH_EMAIL || `rehost-icons-${Date.now()}@test.dev`
  const password = process.env.DH_PASSWORD || 'Rhs' + crypto.randomBytes(6).toString('hex')
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`注册服务账号失败: ${res.status} ${(await res.text()).slice(0, 120)}`)
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('nav_session='))
  if (!cookie) throw new Error('注册成功但未拿到 nav_session')
  console.log(`已注册服务账号 ${email}（用完可在库里删掉 daohang.users 里这行）`)
  return cookie
}

async function fetchBin(url, timeoutMs = 25_000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return { err: 'HTTP ' + res.status }
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim()
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > 3 * 1024 * 1024) return { err: '超过 3MB', perm: true }
    if (buf.byteLength < 50) return { err: '过小', perm: true }
    if (!ct.startsWith('image/')) return { err: '非图片: ' + (ct || '(空)'), perm: true }
    const sub = ct.split('/')[1] || ''
    // 常见 MIME → 文件名后缀；图床按后缀推断 Content-Type，规范一点省得日后困惑
    const EXT_ALIAS = { jpeg: 'jpg', 'svg+xml': 'svg', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico', webp: 'webp' }
    const ext = EXT_ALIAS[sub] || sub.replace(/[^a-z0-9]/g, '') || 'png'
    return { buf, type: ct, ext }
  } catch (e) {
    return { err: e.name === 'AbortError' ? '下载超时' : e.message || '下载失败' }
  } finally {
    clearTimeout(t)
  }
}

async function upload(cookie, buf, type, ext) {
  const form = new FormData()
  form.append('file', new Blob([buf], { type }), `${sha1(buf)}.${ext}`)
  const res = await fetch(`${BASE}/api/upload?uploadFolder=${encodeURIComponent(FOLDER)}`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.url) throw new Error(`上传失败 HTTP ${res.status} ${JSON.stringify(j).slice(0, 120)}`)
  return j.url
}

async function run() {
  const rows = load(PENDING, [])
  if (!rows.length) throw new Error(`没有待处理清单：${PENDING}（见文件头部注释里的导出命令）`)
  const map = load(MAP_FILE, {})
  const index = load(INDEX_FILE, {})

  // 按源 URL 归组：不同站点可能共用同一张图，只下载/上传一次
  const jobs = []
  for (const r of rows) {
    const src = String(r.icon || '').trim()
    if (!src || src.endsWith('/undefined')) continue // 源本身就是坏的占位符，交给前端首字兜底
    jobs.push({ id: r.id, src })
  }
  const bySrc = new Map()
  for (const j of jobs) if (!bySrc.has(j.src)) bySrc.set(j.src, [])
  for (const j of jobs) bySrc.get(j.src).push(j.id)

  // 只有「已经拿到图床外链」的源才算完成；上次失败的会重新排队（上传偶发 500 值得重试）
  const doneSrcs = new Set(Object.values(map).filter((v) => v.url).map((v) => v.src))
  const todo = [...bySrc.entries()].filter(([src]) => !doneSrcs.has(src))
  console.log(`待处理行 ${jobs.length}｜唯一源 ${bySrc.size}｜已完成源 ${bySrc.size - todo.length}｜本次处理 ${todo.length}`)

  const cookie = dryRun ? '' : await ensureCookie()
  const conc = Math.max(1, Number(getArg('conc', '6')))
  const budgetMs = Number(getArg('budget', '540')) * 1000
  const limit = Number(getArg('limit', '0'))
  if (limit > 0) todo.length = Math.min(todo.length, limit)
  const t0 = Date.now()
  let idx = 0
  let n = 0
  const save = () => fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1))

  const worker = async () => {
    while (idx < todo.length && Date.now() - t0 < budgetMs) {
      const [src, ids] = todo[idx++]
      if (dryRun) {
        console.log('  [dry-run]', src)
        continue
      }
      const got = await fetchBin(src)
      if (got.err) {
        for (const id of ids) map[id] = { src, err: got.err }
        save()
        console.log(`  ✗ ${got.err}  ${src.slice(0, 90)}`)
        continue
      }
      const hash = sha1(got.buf)
      // 内容寻址落地一份，方便事后排错/复传（重复源直接覆盖同名文件）
      fs.writeFileSync(path.join(ICONS_DIR, `${hash}.${got.ext}`), got.buf)
      let url = index[hash]
      let reused = Boolean(url)
      if (!url) {
        let lastErr = ''
        for (let attempt = 1; attempt <= 3 && !url; attempt++) {
          try {
            url = await upload(cookie, got.buf, got.type, got.ext)
            index[hash] = url
            fs.writeFileSync(INDEX_FILE, JSON.stringify(index))
          } catch (e) {
            lastErr = e.message
            console.log(`  ↻ 上传第 ${attempt} 次失败：${e.message}`)
            await sleep(2000 * attempt) // 图床偶发 500，退避后重试
          }
        }
        if (!url) {
          for (const id of ids) map[id] = { src, hash, err: lastErr }
          save()
          console.log(`  ✗ 上传放弃 ${lastErr}  ${src.slice(0, 80)}`)
          continue
        }
      }
      for (const id of ids) map[id] = { src, hash, url, reused }
      save()
      n++
      if (n % 25 === 0 || n === todo.length) console.log(`  进度 ${n}/${todo.length}（最近：${reused ? '复用' : '新传'} ${url.slice(-40)}）`)
      await sleep(0)
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))

  const okRows = Object.entries(map).filter(([, v]) => v.url)
  const errRows = Object.entries(map).filter(([, v]) => v.err)
  console.log(`本轮完成 ${n}｜累计成功 ${okRows.length}｜累计失败 ${errRows.length}`)
  if (errRows.length) {
    const byErr = {}
    for (const [, v] of errRows) byErr[v.err] = (byErr[v.err] || 0) + 1
    console.log('失败原因：', JSON.stringify(byErr))
  }

  // 生成落库 SQL（幂等：只更新仍不是图床外链的行）
  const esc = (s) => String(s).replace(/'/g, "''")
  const lines = okRows.map(
    ([id, v]) => `UPDATE daohang.builtin_sites SET icon = '${esc(v.url)}' WHERE id = ${Number(id)} AND icon NOT LIKE 'https://img-bed.ieoc.top/%';`,
  )
  fs.writeFileSync(SQL_FILE, `BEGIN;\n${lines.join('\n')}\nCOMMIT;\n`)
  console.log(`SQL 已写入 ${SQL_FILE}（${lines.length} 条 UPDATE）`)
}

// ── 兜底：源图标已死，改用站点自身 favicon 当源 ────────────────────────
async function faviconPass() {
  const rows = load(PENDING, [])
  const map = load(MAP_FILE, {})
  const index = load(INDEX_FILE, {})
  const todo = rows.filter((r) => !map[r.id]?.url)
  console.log(`待兜底 ${todo.length} 行（源已死的占位/失效链接）`)
  const cookie = dryRun ? '' : await ensureCookie()
  const conc = Math.max(1, Number(getArg('conc', '3')))
  const budgetMs = Number(getArg('budget', '300')) * 1000
  const t0 = Date.now()
  let idx = 0
  const save = () => fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1))

  const worker = async () => {
    while (idx < todo.length && Date.now() - t0 < budgetMs) {
      const r = todo[idx++]
      let src = String(r.icon || '').trim()
      try {
        const res = await fetch(`${BASE}/api/favicon?url=${encodeURIComponent(r.url)}`, {
          signal: AbortSignal.timeout(30_000),
        })
        const j = await res.json()
        if (!j.found || !j.url) {
          console.log(`  – 站点也无 favicon：${r.name}`)
          continue // 不做记录，交给「置空」逻辑
        }
        src = j.url
      } catch (e) {
        console.log(`  ✗ 取 favicon 失败 ${r.name}：${e.message}`)
        continue
      }
      const got = await fetchBin(src)
      if (got.err) {
        console.log(`  ✗ ${r.name} favicon 下载失败：${got.err}`)
        continue
      }
      const hash = sha1(got.buf)
      fs.writeFileSync(path.join(ICONS_DIR, `${hash}.${got.ext}`), got.buf)
      let url = index[hash]
      if (!url) {
        try {
          url = await upload(cookie, got.buf, got.type, got.ext)
          index[hash] = url
          fs.writeFileSync(INDEX_FILE, JSON.stringify(index))
        } catch (e) {
          console.log(`  ✗ ${r.name} 上传失败：${e.message}`)
          continue
        }
      }
      map[r.id] = { src, via: 'favicon', hash, url }
      save()
      console.log(`  ✓ ${r.name} ← ${src.slice(0, 60)}`)
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))

  const esc = (s) => String(s).replace(/'/g, "''")
  const lines = []
  for (const r of rows) {
    const v = map[r.id]
    if (v?.url) lines.push(`UPDATE daohang.builtin_sites SET icon = '${esc(v.url)}' WHERE id = ${Number(r.id)} AND icon NOT LIKE 'https://img-bed.ieoc.top/%';`)
    else lines.push(`UPDATE daohang.builtin_sites SET icon = '' WHERE id = ${Number(r.id)} AND icon NOT LIKE 'https://img-bed.ieoc.top/%';`)
  }
  fs.writeFileSync(SQL_FILE, `BEGIN;\n${lines.join('\n')}\nCOMMIT;\n`)
  const okN = rows.filter((r) => map[r.id]?.url).length
  console.log(`兜底完成：拿到图标 ${okN}｜置空 ${rows.length - okN}｜SQL → ${SQL_FILE}`)
}

if (cmd === 'run') await run()
else if (cmd === 'favicon') await faviconPass()
else {
  console.error('用法：node scripts/imgbed-backfill-rest.mjs run|favicon [--conc=6] [--budget=540] [--limit=N] [--dry-run]')
  process.exit(1)
}
