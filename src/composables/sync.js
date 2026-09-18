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
// 鉴权状态是否已经确认（/api/auth/me 有结果）。
// 初始 authed=false 只代表「还不知道」，不能当成「未登录」——否则冷启动时会先闪一下
// 未登录提示再跳回来（网关在后面，这一次往返能到 1～2s）。所有「未登录」的 UI 都要
// 同时判断 authChecked，见 App.vue。
export const authChecked = ref(false)
export const userEmail = ref('')
export const isAdmin = ref(false)

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
      isAdmin.value = !!d.isAdmin
    } else {
      authed.value = false
      userEmail.value = ''
      isAdmin.value = false
    }
  } catch { authed.value = false } finally {
    authChecked.value = true
  }
  return authed.value
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  return { ok: res.ok && d.ok !== false, error: d.error || '', status: res.status, data: d }
}

export async function login(email, password) {
  const r = await postJSON('/api/auth/login', { email, password })
  if (r.ok) {
    authed.value = true
    userEmail.value = email.trim().toLowerCase()
    isAdmin.value = !!r.data?.isAdmin
  }
  return r
}

export async function register(email, password) {
  const r = await postJSON('/api/auth/register', { email, password })
  if (r.ok) {
    authed.value = true
    userEmail.value = email.trim().toLowerCase()
    isAdmin.value = !!r.data?.isAdmin
  }
  return r
}

export async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
  authed.value = false
  userEmail.value = ''
  isAdmin.value = false
  dirty.clear()
}

// ---- account management ----

export async function changePassword(currentPassword, newPassword) {
  try {
    const res = await fetch('/api/user/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    const d = await res.json().catch(() => ({}))
    return { ok: res.ok && d.ok !== false, error: d.error || '' }
  } catch { return { ok: false, error: '网络异常，请稍后再试' } }
}

export async function deleteAccount(currentPassword) {
  try {
    const res = await fetch('/api/user/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword }),
    })
    const d = await res.json().catch(() => ({}))
    const ok = res.ok && d.ok !== false
    if (ok) {
      authed.value = false
      userEmail.value = ''
      isAdmin.value = false
      dirty.clear()
      ledger = {}            // 云端数据已随账号删除，同步台账归零
      saveLedger(ledger)
    }
    return { ok, error: d.error || '' }
  } catch { return { ok: false, error: '网络异常，请稍后再试' } }
}

// ---- password recovery ----

export async function forgotPassword(email) {
  try {
    const res = await fetch('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const d = await res.json().catch(() => ({}))
    return { ok: res.ok && d.ok !== false, error: d.error || '', message: d.message || '' }
  } catch { return { ok: false, error: '网络异常，请稍后再试', message: '' } }
}

export async function resetPassword(email, code, newPassword) {
  try {
    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword }),
    })
    const d = await res.json().catch(() => ({}))
    return { ok: res.ok && d.ok !== false, error: d.error || '', message: d.message || '' }
  } catch { return { ok: false, error: '网络异常，请稍后再试', message: '' } }
}

// ---- image bed（图标/壁纸上传到自建图床换外链，避免 base64 内联） ----

// 探测图床是否已配置（服务端 IMG_UPLOAD_API）；未配置时前端沿用 base64 内联
export async function probeImageBed() {
  try {
    const res = await fetch('/api/upload')
    if (!res.ok) return false
    const d = await res.json().catch(() => ({}))
    return !!d.enabled
  } catch { return false }
}

export async function uploadImage(file) {
  try {
    const fd = new FormData()
    fd.append('file', file, file.name || 'image.png')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    if (res.status === 401) { authed.value = false; return { ok: false, error: '请先登录' } }
    const d = await res.json().catch(() => ({}))
    return { ok: res.ok && !!d.url, url: d.url || '', error: d.error || '' }
  } catch { return { ok: false, error: '网络异常，请稍后再试' } }
}

// ---- admin ----

async function sendAdmin(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const d = await res.json().catch(() => ({}))
  return { ok: res.ok && d.ok !== false, error: d.error || '', data: d }
}

export async function adminListUsers(q = '') {
  try {
    const url = q ? `/api/admin/users?q=${encodeURIComponent(q)}` : '/api/admin/users'
    const res = await fetch(url)
    const d = await res.json().catch(() => ({}))
    if (res.status === 403) return { ok: false, error: '需要管理员权限', users: [] }
    return { ok: res.ok && d.ok !== false, error: d.error || '', users: d.users || [] }
  } catch { return { ok: false, error: '网络异常，请稍后再试', users: [] } }
}

export const adminResetPassword = (userId, newPassword) => sendAdmin('/api/admin/reset-password', { userId, newPassword })
export const adminDeleteUser = (userId) => sendAdmin('/api/admin/delete-user', { userId })
export const adminSetDisabled = (userId, disabled) => sendAdmin('/api/admin/set-disabled', { userId, disabled })

// ---- wire existing pref events (call once from App onMounted) ----

export function bindPrefEvents() {
  for (const [key, { event }] of Object.entries(KEYS)) {
    window.addEventListener(event, () => markDirty(key))
  }
}
