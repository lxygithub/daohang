// Local display preferences (layout / view mode / phone-grid tuning / label font).
// Shared by App.vue, NavGrid.vue and SettingsModal.vue so all three stay in
// sync through localStorage + window events.

const LAYOUT_KEY = 'nav_layout'   // 'phone' | 'card' | 'list'
const VIEW_KEY = 'nav_view'       // 'grid'  | 'alpha'
const GRID_KEY = 'nav_grid'       // { rows, cols, size }
const FONT_KEY = 'nav_font'       // { size, shadow, color }

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

// ---- Icon size: slider is percentage-based (10% = 48px, 100% = 500px) ----
export const SIZE_MIN_PCT = 10
export const SIZE_MAX_PCT = 100
const SIZE_MIN_PX = 48
const SIZE_MAX_PX = 500

export function pctToPx(pct) {
  const p = Math.min(SIZE_MAX_PCT, Math.max(SIZE_MIN_PCT, Math.round(Number(pct) || SIZE_MIN_PCT)))
  return Math.round(SIZE_MIN_PX + ((p - SIZE_MIN_PCT) * (SIZE_MAX_PX - SIZE_MIN_PX)) / (SIZE_MAX_PCT - SIZE_MIN_PCT))
}

export function pxToPct(px) {
  const v = Number(px)
  if (Number.isNaN(v)) return SIZE_MIN_PCT
  return Math.round(SIZE_MIN_PCT + ((Math.min(SIZE_MAX_PX, Math.max(SIZE_MIN_PX, v)) - SIZE_MIN_PX) * (SIZE_MAX_PCT - SIZE_MIN_PCT)) / (SIZE_MAX_PX - SIZE_MIN_PX))
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
      cols: clamp(raw.cols, 2, 9, d.cols),
      size: clamp(raw.size, SIZE_MIN_PX, SIZE_MAX_PX, d.size),
    }
  } catch { return defaultGrid() }
}

export function saveGrid(g) {
  try { localStorage.setItem(GRID_KEY, JSON.stringify(g)) } catch {}
}

// ---- Label font (icon captions) ----
export function defaultFont() {
  return { size: 14, shadow: false, color: '' }
}

export function loadFont() {
  try {
    const raw = JSON.parse(localStorage.getItem(FONT_KEY))
    const d = defaultFont()
    if (!raw || typeof raw !== 'object') return d
    return {
      size: clamp(raw.size, 12, 30, d.size),
      shadow: !!raw.shadow,
      color: typeof raw.color === 'string' ? raw.color : '',
    }
  } catch { return defaultFont() }
}

export function saveFont(f) {
  try { localStorage.setItem(FONT_KEY, JSON.stringify(f)) } catch {}
}

// Push font prefs into CSS custom properties on :root
export function applyFont(f) {
  const font = f || loadFont()
  const root = document.documentElement
  root.style.setProperty('--label-size', `${clamp(font.size, 12, 30, 14)}px`)
  root.style.setProperty('--label-shadow', font.shadow ? '0 1px 4px rgba(0, 0, 0, 0.85), 0 0 2px rgba(0, 0, 0, 0.6)' : 'none')
  root.style.setProperty('--label-color', font.color || '')
  return font
}

function clamp(v, min, max, fallback) {
  v = Number(v)
  if (Number.isNaN(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

export function emitLayout(v) { window.dispatchEvent(new CustomEvent('layout-changed', { detail: v })) }
export function emitView(v) { window.dispatchEvent(new CustomEvent('view-changed', { detail: v })) }
export function emitGrid(g) { window.dispatchEvent(new CustomEvent('grid-changed', { detail: { ...g } })) }
