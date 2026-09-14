// Local display preferences (layout / view mode / phone-grid tuning / label font).
// Shared by App.vue, NavGrid.vue and SettingsModal.vue so all three stay in
// sync through localStorage + window events.

const LAYOUT_KEY = 'nav_layout'   // 'phone' | 'card' | 'list'
const VIEW_KEY = 'nav_view'       // 'grid'  | 'alpha'
const GRID_KEY = 'nav_grid'       // { rows, cols, size }
const FONT_KEY = 'nav_font'       // { size, shadow, color }
const SEARCH_KEY = 'nav_search'   // { hidden, suggestions, keepContent, hideCategory, hideButton, size, radius, opacity }
const HERO_KEY = 'nav_hero'       // { showClock, showQuote, showLunar, clockSize, clockColor, quoteSize, quoteColor }

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

// ---- Search box preferences ----
export function defaultSearch() {
  return {
    hidden: false,        // 隐藏搜索框
    suggestions: true,    // 显示搜索建议
    keepContent: false,   // 保留搜索框内容
    hideCategory: false,  // 隐藏搜索类别（引擎选择器）
    hideButton: true,     // 隐藏搜索按钮
    size: 100,            // 搜索框大小 %
    radius: 100,          // 搜索框圆角 %（100 = 胶囊）
    opacity: 100,         // 搜索框不透明度 %
  }
}

export function loadSearch() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEARCH_KEY))
    if (!raw || typeof raw !== 'object') return defaultSearch()
    const d = defaultSearch()
    return {
      hidden: !!raw.hidden,
      suggestions: raw.suggestions === undefined ? d.suggestions : !!raw.suggestions,
      keepContent: !!raw.keepContent,
      hideCategory: !!raw.hideCategory,
      hideButton: raw.hideButton === undefined ? d.hideButton : !!raw.hideButton,
      size: clampN(raw.size, 50, 150, d.size),
      radius: clampN(raw.radius, 0, 100, d.radius),
      opacity: clampN(raw.opacity, 30, 100, d.opacity),
    }
  } catch { return defaultSearch() }
}

export function saveSearch(s) {
  try { localStorage.setItem(SEARCH_KEY, JSON.stringify(s)) } catch {}
}

// Push search prefs into CSS custom properties on :root
export function applySearch(s) {
  const p = s || loadSearch()
  const root = document.documentElement
  root.style.setProperty('--sb-scale', String(p.size / 100))
  root.style.setProperty('--sb-radius', String(p.radius / 100))
  root.style.setProperty('--sb-opacity', String(p.opacity / 100))
  return p
}

// ---- Hero (clock / lunar / quote) preferences ----
export function defaultHero() {
  return {
    showClock: true,
    showQuote: true,
    showLunar: true,
    clockSize: 74,        // px, 28-120
    clockColor: '',       // '' = default gradient
    quoteSize: 14,        // px, 12-30
    quoteColor: '',       // '' = theme default
  }
}

export function loadHero() {
  try {
    const raw = JSON.parse(localStorage.getItem(HERO_KEY))
    if (!raw || typeof raw !== 'object') return defaultHero()
    const d = defaultHero()
    return {
      showClock: raw.showClock === undefined ? d.showClock : !!raw.showClock,
      showQuote: raw.showQuote === undefined ? d.showQuote : !!raw.showQuote,
      showLunar: raw.showLunar === undefined ? d.showLunar : !!raw.showLunar,
      clockSize: clampN(raw.clockSize, 28, 120, d.clockSize),
      clockColor: typeof raw.clockColor === 'string' ? raw.clockColor : '',
      quoteSize: clampN(raw.quoteSize, 12, 30, d.quoteSize),
      quoteColor: typeof raw.quoteColor === 'string' ? raw.quoteColor : '',
    }
  } catch { return defaultHero() }
}

export function saveHero(h) {
  try { localStorage.setItem(HERO_KEY, JSON.stringify(h)) } catch {}
}

export function applyHero(h) {
  const p = h || loadHero()
  const root = document.documentElement
  root.style.setProperty('--clock-size', `${p.clockSize}px`)
  root.style.setProperty('--clock-color', p.clockColor || '')
  root.style.setProperty('--quote-size', `${p.quoteSize}px`)
  root.style.setProperty('--quote-color', p.quoteColor || '')
  return p
}

function clampN(v, min, max, fallback) {
  v = Number(v)
  if (Number.isNaN(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function clamp(v, min, max, fallback) {
  v = Number(v)
  if (Number.isNaN(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

export function emitLayout(v) { window.dispatchEvent(new CustomEvent('layout-changed', { detail: v })) }
export function emitView(v) { window.dispatchEvent(new CustomEvent('view-changed', { detail: v })) }
export function emitGrid(g) { window.dispatchEvent(new CustomEvent('grid-changed', { detail: { ...g } })) }
