// Local display preferences (layout / view mode / phone-grid tuning).
// Shared by App.vue, NavGrid.vue and SettingsModal.vue so all three stay in
// sync through localStorage + window events.

const LAYOUT_KEY = 'nav_layout'   // 'phone' | 'card' | 'list'
const VIEW_KEY = 'nav_view'       // 'grid'  | 'alpha'
const GRID_KEY = 'nav_grid'       // { rows, cols, size }

export const LAYOUTS = [
  { id: 'phone', name: '图标' },
  { id: 'card', name: '卡片' },
  { id: 'list', name: '列表' },
]

export function loadLayout() {
  try {
    let v = localStorage.getItem(LAYOUT_KEY)
    if (!v) return 'phone'
    // Migrate: 'card' was the old default → users get the new phone style once
    if (v === 'card') {
      v = 'phone'
      localStorage.setItem(LAYOUT_KEY, v)
    }
    return v
  } catch { return 'phone' }
}

export function saveLayout(v) {
  try { localStorage.setItem(LAYOUT_KEY, v) } catch {}
}

export function loadView() {
  try { return localStorage.getItem(VIEW_KEY) === 'alpha' ? 'alpha' : 'grid' } catch { return 'grid' }
}

export function saveView(v) {
  try { localStorage.setItem(VIEW_KEY, v) } catch {}
}

export function defaultGrid() {
  return { rows: 4, cols: 6, size: 64 }
}

export function loadGrid() {
  try {
    const raw = JSON.parse(localStorage.getItem(GRID_KEY))
    const d = defaultGrid()
    if (!raw || typeof raw !== 'object') return d
    return {
      rows: clamp(raw.rows, 2, 7, d.rows),
      cols: clamp(raw.cols, 3, 9, d.cols),
      size: clamp(raw.size, 48, 140, d.size),
    }
  } catch { return defaultGrid() }
}

export function saveGrid(g) {
  try { localStorage.setItem(GRID_KEY, JSON.stringify(g)) } catch {}
}

function clamp(v, min, max, fallback) {
  v = Number(v)
  if (Number.isNaN(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

export function emitLayout(v) { window.dispatchEvent(new CustomEvent('layout-changed', { detail: v })) }
export function emitView(v) { window.dispatchEvent(new CustomEvent('view-changed', { detail: v })) }
export function emitGrid(g) { window.dispatchEvent(new CustomEvent('grid-changed', { detail: { ...g } })) }
