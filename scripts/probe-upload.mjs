// 图床恢复探针：取 1 个真实待转存图标走完整上传链路（daohang 代理 → 图床 → TG）。
// 成功 → 结果写入 rehost-state.jsonl（正式转存，不浪费）；失败 → 什么都不写，只打印诊断。
// 用法：node scripts/probe-upload.mjs   （配合 bash 循环轮询直到成功）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const ICONS = path.join(DIR, 'icons')
const BASE = process.env.DH_BASE || 'https://daohang.ieoc.top'
const FOLDER = 'builtin-icons'
const STATE_FILE = path.join(DATA, 'rehost-state.jsonl')
const COOKIE_FILE = path.join(DATA, 'dh-cookie.txt')
const SRC_MAP_FILE = path.join(DATA, 'prefetch-src-map.json')

const sites = JSON.parse(fs.readFileSync(path.join(DATA, 'builtin-sites.json'), 'utf8'))
const state = new Map()
for (const line of fs.readFileSync(STATE_FILE, 'utf8').split('\n').filter(Boolean)) {
  try { const r = JSON.parse(line); state.set(r.src, r) } catch { }
}
const srcMap = fs.existsSync(SRC_MAP_FILE) ? JSON.parse(fs.readFileSync(SRC_MAP_FILE, 'utf8')) : {}

const pending = [...new Set(sites.map(s => s.iconSrc).filter(Boolean))].filter(src => !state.has(src))
const pick = pending.find(src => {
  const m = srcMap[src]
  if (!m?.h) return false
  try { return fs.statSync(path.join(ICONS, `${m.h}.${m.e}`)).size < 15000 } catch { return false }
})
if (!pick) { console.log('没有可用的待转存小图标'); process.exit(2) }

const m = srcMap[pick]
const buf = fs.readFileSync(path.join(ICONS, `${m.h}.${m.e}`))
const cookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim()

const t0 = Date.now()
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), 40000)
try {
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'image/' + (m.e === 'jpg' ? 'jpeg' : m.e) }), `icon_${m.h.slice(0, 16)}.${m.e}`)
  const res = await fetch(`${BASE}/api/upload?uploadFolder=${FOLDER}`, {
    method: 'POST', body: fd, headers: { Cookie: cookie }, signal: ctrl.signal,
  })
  const body = await res.json().catch(() => ({}))
  const ms = Date.now() - t0
  if (res.ok && body.ok && body.url) {
    fs.appendFileSync(STATE_FILE, JSON.stringify({ src: pick, ok: true, url: body.url, hash: m.h }) + '\n')
    console.log(`PROBE OK ${ms}ms → ${body.url}`)
  } else {
    console.log(`PROBE FAIL ${res.status} ${ms}ms body=${JSON.stringify(body).slice(0, 200)}`)
    process.exit(1)
  }
} catch (e) {
  console.log(`PROBE FAIL ${e.name === 'AbortError' ? '上传超时 40s' : (e.message || e)}`)
  process.exit(1)
} finally { clearTimeout(timer) }
