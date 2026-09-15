// Account sync layer — bridges localStorage prefs ⇄ D1 via /api/user/prefs.
//
// 设计：
//   * 未登录：一切照旧，纯 localStorage，零网络请求
//   * 登录后：
//       - 监听现有偏好事件（layout/view/grid/search/hero/engines + 补发的 font/theme/engine）
//         → 记录本地时间戳（nav_sync_t 台账）→ 防抖 1.5s 批量 PUT
//       - pullAndMerge()：登录成功 / 启动时会话仍有效时执行，
//         按 key 以 updated_at 做 last-write-wins 合并（不是整包覆盖）
//   * config（服务列表+背景）走 /api/config 会话通道，不入本模块的 key 空间
//   * applyServer 应用服务端值时抑制回推，避免同步风暴
import { ref } from 'vue'
import { applyFont } from './usePrefs'

export const authed = ref(false)
export const userEmail = ref('')

const LEDGER_KEY = 'nav_sync_t'   // { [syncKey]: epochMs } 本地最后修改时间台账
const DEBOUNCE_MS = 1500

// syncKey → { ls: localStorage 键, event: 广播事件 }
const KEYS = {
  layout:  { ls: 'nav_layout',         event: 'layout-changed' },
  view:    { ls: 'nav_view',           event: 'view-changed' },
  grid:    { ls: 'nav_grid',           event: 'grid-changed' },
  font:    { ls: 'nav_font',           event: 'font-changed' },
  search:  { ls: 'nav_search',         event: 'search-changed' },
  hero:    { ls: 'nav_hero',           event: 'hero-changed' },
  theme:   { ls: 'nav_theme',          event: 'theme-changed' },
  engines: { ls: 'nav_custom_engines', event: 'custom-engines-changed' },
  engine:  { ls: 'nav_engine',         event: 'engine-changed' },
}

// ---- ledger ----

function loadLedger() {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || {} } catch { return {} }
}
function saveLedger(l) {
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(l)) } catch {}
}
let ledger = loadLedger()

export function noteConfigSynced(t) {
  if (Number.isFinite(t) && t > 0) { ledger.config = t; saveLedger(ledger) }
}

// ---- push (debounced) ----

const dirty = new Set()
let pushTimer = null
const suppressing = new Set()

export function markDirty(key) {
  if (suppressing.has(key)) return
  if (!KEYS[key] && key !== 'config') return
  ledger[key] = Date.now()
  saveLedger(ledger)
  if (!authed.value || key === 'config') return // config 有自己的保存通道
  dirty.add(key)
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushDirty, DEBOUNCE_MS)
}

async function pushDirty() {
  if (!authed.value || dirty.size === 0) return
  const keys = [...dirty]
  dirty.clear()
  const entries = []
  for (const k of keys) {
    const raw = localStorage.getItem(KEYS[k].ls)
    if (raw === null) continue
    entries.push({ key: k, value: raw, t: ledger[k] || Date.now() })
  }
  if (!entries.length) return
  try {
    const res = await fetch('/api/user/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
    if (res.status === 401) { authed.value = false; return }
    const d = await res.json().catch(() => ({}))
    // 冲突 = 服务端在本次编辑后有更新的写入（另一设备）→ 服从时间戳，
    // 本地显示保留到下次 pull；把台账推进到服务端时间以便下次编辑能胜出
    for (const [k, t] of Object.entries(d.conflicts || {})) {
      ledger[k] = Math.max(ledger[k] || 0, t)
    }
    saveLedger(ledger)
  } catch {} // 离线容错：脏标记已在 markDirty 写入台账，下次改动会重试
}

// ---- pull & merge ----

export async function pullAndMerge() {
  if (!authed.value) return
  try {
    const res = await fetch('/api/user/prefs')
    if (res.status === 401) { authed.value = false; return }
    if (!res.ok) return
    const { data } = await res.json()
    const toPush = []

    const allKeys = new Set([...Object.keys(KEYS), ...Object.keys(data || {})])
    for (const k of allKeys) {
      if (!KEYS[k]) continue // 服务端存在但前端未知的 key：忽略（向前兼容）
      const sv = data[k]?.v
      const st = data[k]?.t || 0
      const lv = localStorage.getItem(KEYS[k].ls)
      const lt = ledger[k] || 0

      if (sv === undefined || sv === null) {
        if (lv !== null) toPush.push({ key: k, value: lv, t: lt || Date.now() })
        continue
      }
      if (lv === null) { applyServer(k, sv); ledger[k] = st; continue }
      if (st > lt) { applyServer(k, sv); ledger[k] = st }
      else if (lt > st) toPush.push({ key: k, value: lv, t: lt })
    }
    saveLedger(ledger)

    if (toPush.length) {
      await fetch('/api/user/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: toPush }),
      })
    }
    // 服务端 config（服务列表+背景）总是跟随账号
    window.dispatchEvent(new CustomEvent('server-config-changed'))
  } catch {}
}

// ---- apply server value to local UI ----

function applyServer(key, raw) {
  try { localStorage.setItem(KEYS[key].ls, raw) } catch {}
  suppressing.add(key)
  try {
    if (key === 'font') {
      try { applyFont(JSON.parse(raw)) } catch { applyFont(undefined) }
    }
    window.dispatchEvent(new CustomEvent(KEYS[key].event, {
      detail: key === 'search' || key === 'grid' ? JSON.parse(raw) : raw,
    }))
  } catch {} finally {
    suppressing.delete(key)
  }
}

// ---- auth flows ----

export async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me')
    if (res.ok) {
      const d = await res.json()
      authed.value = !!d.ok
      userEmail.value = d.email || ''
    } else {
      authed.value = false
      userEmail.value = ''
    }
  } catch { authed.value = false }
  return authed.value
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  return { ok: res.ok && d.ok !== false, error: d.error || '', status: res.status }
}

export async function login(email, password) {
  const r = await postJSON('/api/auth/login', { email, password })
  if (r.ok) { authed.value = true; userEmail.value = email.trim().toLowerCase() }
  return r
}

export async function register(email, password) {
  const r = await postJSON('/api/auth/register', { email, password })
  if (r.ok) { authed.value = true; userEmail.value = email.trim().toLowerCase() }
  return r
}

export async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
  authed.value = false
  userEmail.value = ''
  dirty.clear()
}

// ---- wire existing pref events (call once from App onMounted) ----

export function bindPrefEvents() {
  for (const [key, { event }] of Object.entries(KEYS)) {
    window.addEventListener(event, () => markDirty(key))
  }
}
