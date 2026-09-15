<script setup>
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import { useConfig, getStoredPassword, AUTH_KEY } from './composables/useConfig'
import { useToast } from './composables/useToast'
import {
  loadView, saveView, emitView, applyFont,
  loadSearch, saveSearch, applySearch,
  loadHero, saveHero, applyHero,
} from './composables/usePrefs'
import solarlunar from 'solarlunar'
const { solar2lunar, getFestivals } = solarlunar
import NavGrid from './components/NavGrid.vue'
import EditModal from './components/EditModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import PasswordModal from './components/PasswordModal.vue'
import AuthModal from './components/AuthModal.vue'
import AccountModal from './components/AccountModal.vue'
import AdminModal from './components/AdminModal.vue'
import Toast from './components/Toast.vue'
import {
  authed, userEmail, isAdmin, checkAuth, pullAndMerge, logout as syncLogout,
  bindPrefEvents, noteConfigSynced,
} from './composables/sync'
const buildTime = __BUILD_TIME__

const { config, loading, loadConfig, saveConfig } = useConfig()
const { message: toastMessage, visible: toastVisible, showToast } = useToast()

const searchQuery = ref('')
const searchInputRef = ref(null)

// Theme
const THEME_KEY = 'nav_theme'
const isLight = ref(false)

function applyTheme(light) {
  isLight.value = light
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', light ? '#eef1f7' : '#0d1017')
}

function toggleTheme() {
  applyTheme(!isLight.value)
  try { localStorage.setItem(THEME_KEY, isLight.value ? 'light' : 'dark') } catch {}
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: isLight.value ? 'light' : 'dark' }))
}

// Clock, lunar calendar & greeting
const timeText = ref('')
const secText = ref('')
const dateText = ref('')
const greeting = ref('')
const lunarText = ref('')
const festivalText = ref('')
const quote = ref(null)
const quoteLoading = ref(false)

// Solar festivals (lunar ones come from solarlunar.getFestivals)
const SOLAR_FESTIVALS = {
  '1-1': '元旦', '2-14': '情人节', '3-8': '妇女节', '5-1': '劳动节',
  '6-1': '儿童节', '9-10': '教师节', '10-1': '国庆节', '12-25': '圣诞节',
}

function updateLunar(now) {
  try {
    const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate()
    const lunar = solar2lunar(y, m, d)
    if (!lunar || lunar === -1) { lunarText.value = ''; return }
    lunarText.value = `农历${lunar.gzYear}年${lunar.monthCn}${lunar.dayCn}`
    const fests = [...new Set([...(getFestivals(y, m, d) || []), SOLAR_FESTIVALS[`${m}-${d}`] || ''].filter(Boolean))]
    const tags = []
    if (lunar.isTerm && lunar.term) tags.push(lunar.term)
    tags.push(...fests)
    festivalText.value = tags.join(' · ')
  } catch { lunarText.value = '' }
}

// 一言
async function fetchQuote() {
  if (quoteLoading.value) return
  quoteLoading.value = true
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3500)
    const res = await fetch('https://v1.hitokoto.cn/?c=i&c=k&c=d', { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return
    const d = await res.json()
    if (d.hitokoto) quote.value = { text: d.hitokoto, from: d.from || '' }
  } catch {} finally {
    quoteLoading.value = false
  }
}

function updateClock() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  timeText.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  secText.value = pad(now.getSeconds())

  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  dateText.value = `${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]}`
  updateLunar(now)

  const h = now.getHours()
  if (h < 5) greeting.value = '夜深了'
  else if (h < 9) greeting.value = '早上好'
  else if (h < 12) greeting.value = '上午好'
  else if (h < 14) greeting.value = '中午好'
  else if (h < 18) greeting.value = '下午好'
  else greeting.value = '晚上好'
}

// ---- Search engines (icon-based, custom engines supported) ----
const ENGINES = [
  { id: 'local', name: '本地', hint: '搜索服务…', url: '', icon: '/engines/local.png' },
  { id: 'baidu', name: '百度', hint: '百度一下…', url: 'https://www.baidu.com/s?wd={q}', icon: '/engines/baidu.png' },
  { id: 'bing', name: '必应', hint: '必应搜索…', url: 'https://www.bing.com/search?q={q}', icon: '/engines/bing.png' },
  { id: 'google', name: 'Google', hint: 'Google 搜索…', url: 'https://www.google.com/search?q={q}', icon: '/engines/google.png' },
  { id: 'yahoo', name: 'Yahoo', hint: 'Yahoo 搜索…', url: 'https://search.yahoo.com/search?p={q}', icon: '/engines/yahoo.png' },
  { id: 'yandex', name: 'Yandex', hint: 'Yandex 搜索…', url: 'https://yandex.com/search/?text={q}', icon: '/engines/yandex.png' },
]
const ENGINE_KEY = 'nav_engine'
const CUSTOM_ENGINE_KEY = 'nav_custom_engines'

function loadCustomEngines() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_ENGINE_KEY))
    if (!Array.isArray(raw)) return []
    return raw
      .filter(e => e && e.id && e.name && e.url && e.url.includes('{q}'))
      .map(e => ({ id: e.id, name: e.name, hint: `${e.name} 搜索…`, url: e.url, icon: e.icon || '', custom: true }))
  } catch { return [] }
}

const customEngines = ref(loadCustomEngines())
const allEngines = computed(() => [...ENGINES, ...customEngines.value])

function reloadCustomEngines() {
  customEngines.value = loadCustomEngines()
  if (!allEngines.value.some(e => e.id === engineId.value)) {
    engineId.value = 'local'
    try { localStorage.setItem(ENGINE_KEY, 'local') } catch {}
  }
}

const engineId = ref(localStorage.getItem(ENGINE_KEY) || 'local')
const engine = computed(() => allEngines.value.find(e => e.id === engineId.value) || ENGINES[0])
const showEngineMenu = ref(false)

function selectEngine(id) {
  engineId.value = id
  showEngineMenu.value = false
  try { localStorage.setItem(ENGINE_KEY, id) } catch {}
  window.dispatchEvent(new CustomEvent('engine-changed', { detail: id }))
  searchInputRef.value?.focus()
}

function persistCustomEngines() {
  try {
    localStorage.setItem(CUSTOM_ENGINE_KEY, JSON.stringify(
      customEngines.value.map(e => ({ id: e.id, name: e.name, url: e.url, icon: e.icon || '' }))
    ))
  } catch {}
}

function addCustomEngine(name, url) {
  const n = (name || '').trim()
  let u = (url || '').trim()
  if (!n || !u) return '请填写名称和搜索链接'
  if (!/\{q\}/.test(u)) {
    // Auto-append the {q} placeholder for plain result-page URLs
    u = u.includes('?') ? `${u}&q={q}` : `${u}{q}`
  }
  try { new URL(u.replace('{q}', 'test')) } catch { return '链接格式不正确' }
  const id = 'ce-' + Date.now()
  // Try the site favicon for the menu icon
  let icon = ''
  try { icon = new URL(u.replace('{q}', '')).origin + '/favicon.ico' } catch {}
  customEngines.value = [...customEngines.value, { id, name: n, hint: `${n} 搜索…`, url: u, icon, custom: true }]
  persistCustomEngines()
  return ''
}

function removeCustomEngine(id) {
  customEngines.value = customEngines.value.filter(e => e.id !== id)
  persistCustomEngines()
  if (engineId.value === id) selectEngine('local')
}

// Inline add-engine form inside the dropdown
const addingEngine = ref(false)
const newEngineName = ref('')
const newEngineUrl = ref('')

function submitCustomEngine() {
  const err = addCustomEngine(newEngineName.value, newEngineUrl.value)
  if (err) { showToast(err); return }
  newEngineName.value = ''
  newEngineUrl.value = ''
  addingEngine.value = false
  showToast('搜索引擎已添加')
}

// ---- Search box preferences (hidden / suggestions / button / category) ----
const searchPrefs = ref(loadSearch())

function onSearchPrefsChanged(e) {
  searchPrefs.value = { ...loadSearch(), ...(e.detail || {}) }
  applySearch(searchPrefs.value)
  if (searchPrefs.value.hidden) showEngineMenu.value = false
}

// ---- Hero preferences (clock / lunar / quote visibility & styling) ----
const heroPrefs = ref(loadHero())

function onHeroPrefsChanged() {
  heroPrefs.value = loadHero()
  applyHero(heroPrefs.value)
}

function persistSearchQuery() {
  try {
    if (searchPrefs.value.keepContent) localStorage.setItem('nav_search_query', searchQuery.value)
    else localStorage.removeItem('nav_search_query')
  } catch {}
}

const effectiveFilter = computed(() =>
  engine.value.id === 'local' ? searchQuery.value : ''
)

// Search suggestions: local matches + direct-search action
const showSuggestions = computed(() =>
  searchPrefs.value.suggestions &&
  !searchPrefs.value.hidden &&
  searchQuery.value.trim().length > 0
)

const suggestionMatches = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q || !config.value) return []
  return (config.value.services || [])
    .filter(s => s.name.toLowerCase().includes(q) || (s.group || '').toLowerCase().includes(q))
    .slice(0, 5)
})

function openServiceDirect(svc) {
  searchQuery.value = ''
  persistSearchQuery()
  window.dispatchEvent(new CustomEvent('open-service-by-id', { detail: svc.id }))
}

function applySuggestion() {
  handleSearchEnter()
  showEngineMenu.value = false
}

// Keyboard shortcut: "/" focuses search
function handleKeydown(e) {
  if (e.key === 'Escape') {
    if (editMode.value) { editMode.value = false; return }
    if (fabMenuOpen.value) { fabMenuOpen.value = false; return }
    if (addingEngine.value) { addingEngine.value = false; return }
    if (userMenuOpen.value) { userMenuOpen.value = false; return }
    showEngineMenu.value = false
    return
  }
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  if (searchPrefs.value.hidden) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
  e.preventDefault()
  searchInputRef.value?.focus()
}

function handleOpenServiceById(e) {
  const svc = config.value?.services?.find(s => s.id === e.detail)
  if (svc) window.open(svc.url, '_blank')
}

// Enter in search:
//  - engine selected → open engine results in a new tab
//  - local: URL → open directly, otherwise → open first local match
function handleSearchEnter() {
  const q = searchQuery.value.trim()
  if (!q) return
  if (engine.value.id !== 'local') {
    window.open(engine.value.url.replace('{q}', encodeURIComponent(q)), '_blank')
    return
  }
  if (/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(q)) {
    window.open(q.includes('://') ? q : 'https://' + q, '_blank')
    return
  }
  window.dispatchEvent(new CustomEvent('open-first-match'))
}

// ---- Long-press edit mode (global) ----
const editMode = ref(false)

// 首屏入场动画窗口：fadeInUp 只在 .app-boot 下生效，加载完成后摘除，
// 此后编辑模式进出（wiggle ↔ 无动画）不会重放入场动画
const appBooted = ref(false)

function setEditMode(v) {
  editMode.value = v
}

function handleDocClick(e) {
  // Close engine menu when clicking outside
  if (showEngineMenu.value && !e.target.closest('.engine-anchor')) {
    showEngineMenu.value = false
  }
  // Close the floating action cluster when clicking outside
  if (fabMenuOpen.value && !e.target.closest('.fab-cluster')) {
    fabMenuOpen.value = false
  }
  if (userMenuOpen.value && !e.target.closest('.fab-cluster')) {
    userMenuOpen.value = false
  }
  if (!editMode.value) return
  // Clicking a card or inside a modal keeps edit mode; blank space exits.
  if (
    e.target.closest('.card') ||
    e.target.closest('.modal-overlay') ||
    e.target.closest('.settings-drawer') ||
    e.target.closest('.drawer-catch') ||
    e.target.closest('.fab-cluster')
  ) return
  editMode.value = false
}

// Password verification
const verified = ref(false)
const showPasswordModal = ref(false)
const pendingAction = ref(null)

function ensureVerified(callback) {
  // 登录用户免密（账号即凭证），访客保留管理密码流程
  if (verified.value || authed.value) {
    callback()
    return
  }
  pendingAction.value = callback
  showPasswordModal.value = true
}

function onPasswordVerified(password) {
  verified.value = true
  showPasswordModal.value = false
  if (password) {
    try { sessionStorage.setItem(AUTH_KEY, btoa(password)) } catch {}
  }
  if (pendingAction.value) {
    pendingAction.value()
    pendingAction.value = null
  }
}

function onPasswordCancel() {
  showPasswordModal.value = false
  pendingAction.value = null
}

// Edit modal
const showEditModal = ref(false)
const editingIndex = ref(-1)

function openAddModal() {
  editingIndex.value = -1
  showEditModal.value = true
}

function openEditModal(index) {
  editingIndex.value = index
  showEditModal.value = true
}

function closeEditModal() {
  showEditModal.value = false
  editingIndex.value = -1
}

// Settings drawer
const showSettingsModal = ref(false)

// ---- Account (register / login / sync) ----
const showAuthModal = ref(false)
const showAccountModal = ref(false)
const showAdminModal = ref(false)
const userMenuOpen = ref(false)
const syncingNow = ref(false)

function onAuthed(mail, mode) {
  showToast(mode === 'register' ? '注册成功，正在同步偏好…' : '登录成功，正在同步偏好…')
  pullAndMerge()
}

async function doLogout() {
  userMenuOpen.value = false
  await syncLogout()
  showToast('已退出登录')
  // 回到访客视角：重新拉取全局默认配置
  await loadConfig()
  applyBackground()
}

function openAccount() {
  userMenuOpen.value = false
  showAccountModal.value = true
}

function openAdmin() {
  userMenuOpen.value = false
  showAdminModal.value = true
}

async function onAccountDeleted() {
  showToast('账号已注销，云端数据已清除')
  // 回到访客视角（本机偏好保留）
  await loadConfig()
  applyBackground()
}

async function syncNow() {
  if (syncingNow.value) return
  syncingNow.value = true
  try {
    await pullAndMerge()
    await loadConfig()
    applyBackground()
    showToast('已从云端同步')
  } finally {
    syncingNow.value = false
    userMenuOpen.value = false
  }
}

// ---- Floating action cluster (pagoda menu) ----
// The old topbar buttons collapse into one round button;
// clicking it fans the actions out in a horizontal row.
const fabMenuOpen = ref(false)

function toggleFabMenu() {
  fabMenuOpen.value = !fabMenuOpen.value
}

function runFabAction(fn) {
  fabMenuOpen.value = false
  fn()
}

// ---- View mode (grid / alpha) ----
const viewMode = ref(loadView())

function toggleViewMode() {
  viewMode.value = viewMode.value === 'alpha' ? 'grid' : 'alpha'
  saveView(viewMode.value)
  emitView(viewMode.value)
}

// ---- Background & wallpaper ----
function applyBackground() {
  const bg = config.value?.background
  const wp = config.value?.wallpaper
  const blur = Number(config.value?.wallpaperBlur) || 0
  const decor = document.querySelector('.bg-decor')
  const layer = document.querySelector('.wp-layer')

  if (wp && wp.type !== 'none' && wp.value) {
    if (layer) {
      layer.style.backgroundImage = `url("${wp.value}")`
      layer.style.setProperty('--wp-blur', blur + 'px')
      layer.classList.add('active')
    }
    decor?.classList.add('dimmed')
    document.body.style.background = '#0d1017'
    return
  }
  layer?.classList.remove('active')
  if (layer) layer.style.backgroundImage = ''
  decor?.classList.remove('dimmed')
  const isDefault = !bg || !bg.value || bg.value === '#0d1017'
  document.body.style.background = isDefault ? '' : bg.value
}

// ---- Windmill FAB: random Bing wallpaper ----
const fabLoading = ref(false)

function setWallpaper(value) {
  const cfg = config.value
  if (!cfg) return
  cfg.wallpaper = value ? { type: 'url', value } : { type: 'none', value: '' }
  applyBackground()
  saveConfig()
}

async function randomWallpaper() {
  if (fabLoading.value) return
  fabLoading.value = true
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    const res = await fetch('/api/wallpaper', { signal: ctrl.signal })
    clearTimeout(timer)
    const d = await res.json()
    if (!d.url) throw new Error(d.error || 'no url')
    ensureVerified(() => {
      setWallpaper(d.url)
      showToast('壁纸已更换')
    })
  } catch {
    showToast('获取壁纸失败，请稍后再试')
  } finally {
    fabLoading.value = false
  }
}

// Provide shared state to children
provide('config', config)
provide('saveConfig', saveConfig)
provide('showToast', showToast)
provide('ensureVerified', ensureVerified)
provide('openEditModal', openEditModal)
provide('editMode', editMode)
provide('setEditMode', setEditMode)
provide('setWallpaper', setWallpaper)

onMounted(async () => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('apply-background', applyBackground)
  window.addEventListener('click', handleDocClick, true)
  window.addEventListener('search-changed', onSearchPrefsChanged)
  window.addEventListener('hero-changed', onHeroPrefsChanged)
  window.addEventListener('custom-engines-changed', reloadCustomEngines)
  window.addEventListener('open-service-by-id', handleOpenServiceById)
  // 同步层：偏好事件 → 云端；服务端应用 → 本地状态
  bindPrefEvents()
  window.addEventListener('theme-changed', () => {
    let light = false
    try { light = localStorage.getItem(THEME_KEY) === 'light' } catch {}
    if (light !== isLight.value) applyTheme(light)
  })
  window.addEventListener('view-changed', () => { viewMode.value = loadView() })
  window.addEventListener('engine-changed', () => {
    const id = localStorage.getItem(ENGINE_KEY) || 'local'
    if (allEngines.value.some(e => e.id === id)) engineId.value = id
    else reloadCustomEngines()
  })
  window.addEventListener('server-config-changed', async () => {
    await loadConfig()
    applyBackground()
  })
  // 会话内记住验证状态，刷新无需重复输密码
  if (getStoredPassword()) verified.value = true
  let savedLight = false
  try { savedLight = localStorage.getItem(THEME_KEY) === 'light' } catch {}
  applyTheme(savedLight)
  applyFont()
  applySearch()
  applyHero()
  // 保留搜索框内容：恢复上次输入
  if (searchPrefs.value.keepContent) {
    try { searchQuery.value = localStorage.getItem('nav_search_query') || '' } catch {}
  }
  fetchQuote()
  await loadConfig()
  applyBackground()
  // 入场动画（含最长 0.5s stagger + 0.45s 动画本身）播完后再摘除 .app-boot
  setTimeout(() => { appBooted.value = true }, 1100)
  // 会话仍有效时静默同步一次云端偏好
  if (await checkAuth()) pullAndMerge()
})

let clockTimer = null

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('apply-background', applyBackground)
  window.removeEventListener('click', handleDocClick, true)
  window.removeEventListener('search-changed', onSearchPrefsChanged)
  window.removeEventListener('hero-changed', onHeroPrefsChanged)
  window.removeEventListener('custom-engines-changed', reloadCustomEngines)
  window.removeEventListener('open-service-by-id', handleOpenServiceById)
})
</script>

<template>
  <!-- Wallpaper layer (blurred, below aurora) -->
  <div class="wp-layer" aria-hidden="true"></div>

  <!-- Aurora decoration -->
  <div class="bg-decor" aria-hidden="true">
    <div class="aurora aurora-1"></div>
    <div class="aurora aurora-2"></div>
    <div class="aurora aurora-3"></div>
    <div class="noise"></div>
  </div>

  <!-- Page -->
  <main class="page" :class="{ 'app-boot': !appBooted }">
    <section class="hero">
      <template v-if="heroPrefs.showClock">
        <div class="clock">
          <span class="clock-time" :class="{ 'plain-color': !!heroPrefs.clockColor }">{{ timeText }}</span>
          <span class="clock-sec">{{ secText }}</span>
        </div>
        <div class="hero-meta">
          <span>{{ dateText }}</span>
          <template v-if="heroPrefs.showLunar && lunarText">
            <span class="sep">·</span>
            <span class="lunar">{{ lunarText }}</span>
          </template>
          <template v-if="heroPrefs.showLunar && festivalText">
            <span class="sep">·</span>
            <span class="festival">{{ festivalText }}</span>
          </template>
          <span class="sep">·</span>
          <span class="greeting">{{ greeting }}</span>
        </div>
      </template>
      <!-- 名句位于时间下方、搜索框上方 -->
      <div
        v-if="heroPrefs.showQuote && quote"
        class="quote"
        title="点击换一句"
        @click="fetchQuote"
      >
        <span class="quote-text">「{{ quote.text }}」</span>
        <span v-if="quote.from" class="quote-from">—— {{ quote.from }}</span>
      </div>
      <form v-if="!searchPrefs.hidden" autocomplete="off" class="search-box" @submit.prevent>
        <div v-if="!searchPrefs.hideCategory" class="engine-anchor">
          <button type="button" class="engine-btn" :title="`搜索引擎：${engine.name}`" @click.stop="showEngineMenu = !showEngineMenu">
            <img v-if="engine.icon" class="engine-icon" :src="engine.icon" alt="" referrerpolicy="no-referrer" @error="e => e.target.style.display = 'none'">
            <span v-else class="engine-dot"></span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <transition name="menu-pop">
            <div v-if="showEngineMenu" class="engine-menu" @click.stop>
              <div class="engine-grid">
                <button
                  v-for="e in allEngines"
                  :key="e.id"
                  type="button"
                  class="engine-cell"
                  :class="{ active: e.id === engineId }"
                  :title="e.name"
                  @click="selectEngine(e.id)"
                >
                  <img v-if="e.icon" :src="e.icon" alt="" referrerpolicy="no-referrer" @error="e2 => e2.target.replaceWith(Object.assign(document.createElement('span'), { className: 'engine-fallback', textContent: e.name.charAt(0) }))">
                  <span v-else class="engine-fallback">{{ e.name.charAt(0) }}</span>
                  <svg v-if="e.id === engineId" class="engine-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
                <button type="button" class="engine-cell add" title="添加自定义搜索引擎" @click="addingEngine = !addingEngine">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              </div>
              <div v-if="addingEngine" class="engine-add-form" @keydown.enter.prevent="submitCustomEngine">
                <input type="text" v-model="newEngineName" placeholder="名称，如：知乎">
                <input type="text" v-model="newEngineUrl" placeholder="搜索链接，用 {q} 表示关键词">
                <div class="engine-add-actions">
                  <button type="button" class="btn-text ghost" @click="addingEngine = false">取消</button>
                  <button type="button" class="btn-text primary" @click="submitCustomEngine">添加</button>
                </div>
              </div>
            </div>
          </transition>
        </div>
        <input
          ref="searchInputRef"
          type="text"
          v-model="searchQuery"
          :placeholder="engine.hint"
          readonly
          @focus="e => e.target.removeAttribute('readonly')"
          @blur="e => !e.target.value && e.target.setAttribute('readonly', '')"
          @keydown.enter="handleSearchEnter"
          @input="persistSearchQuery"
        >
        <button
          v-if="!searchPrefs.hideButton"
          type="button"
          class="search-submit"
          title="搜索"
          @click="handleSearchEnter"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <circle cx="11" cy="11" r="7"/>
            <line x1="21" y1="21" x2="16.2" y2="16.2"/>
          </svg>
        </button>
        <transition name="menu-pop">
          <div v-if="showSuggestions" class="search-suggest">
            <button
              v-for="svc in suggestionMatches"
              :key="svc.id"
              type="button"
              class="suggest-item"
              @mousedown.prevent="openServiceDirect(svc)"
            >
              <span class="suggest-name">{{ svc.name }}</span>
              <span class="suggest-host">{{ svc.url }}</span>
            </button>
            <button type="button" class="suggest-item search" @mousedown.prevent="applySuggestion">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <circle cx="11" cy="11" r="7"/>
                <line x1="21" y1="21" x2="16.2" y2="16.2"/>
              </svg>
              <span class="suggest-name">使用 {{ engine.name }} 搜索「{{ searchQuery.trim() }}」</span>
            </button>
          </div>
        </transition>
      </form>
    </section>

    <div v-if="loading" class="state-wrap">
      <div class="spinner"></div>
      <div>正在加载…</div>
    </div>
    <div v-else-if="!config" class="state-wrap">
      <div>加载失败，请刷新重试</div>
    </div>
    <NavGrid
      v-else
      :services="config.services || []"
      :filter="effectiveFilter"
      :view="viewMode"
      @reordered="saveConfig"
    />
  </main>

  <!-- Windmill — random Bing wallpaper (pinned bottom-right) -->
  <button
    class="fab fab-windmill"
    :class="{ loading: fabLoading }"
    title="随机壁纸（Bing 每日图）"
    @click.stop="randomWallpaper"
  >
    <img src="/windmill.svg" alt="" draggable="false">
  </button>

  <!-- Pagoda menu — pinned top-right -->
  <div class="fab-cluster">
    <!-- Pagoda menu: actions fan out in a horizontal row -->
    <div class="fab-anchor">
      <transition name="fab-row">
        <div v-if="fabMenuOpen" class="fab-row" @click.stop>
          <button class="icon-btn fab-item" :title="viewMode === 'alpha' ? '切换到网格视图' : '切换到字母视图'" @click="runFabAction(toggleViewMode)">
            <svg v-if="viewMode === 'alpha'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7h9"/>
              <path d="M4 12h7"/>
              <path d="M4 17h5"/>
              <path d="M17 6v12"/>
              <path d="M14 15l3 3 3-3"/>
            </svg>
          </button>
          <button class="icon-btn fab-item" :title="isLight ? '切换到暗色' : '切换到亮色'" @click="runFabAction(toggleTheme)">
            <svg v-if="isLight" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="4"/>
              <line x1="12" y1="2" x2="12" y2="4"/>
              <line x1="12" y1="20" x2="12" y2="22"/>
              <line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/>
              <line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
              <line x1="2" y1="12" x2="4" y2="12"/>
              <line x1="20" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/>
              <line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>
            </svg>
          </button>
          <button class="icon-btn fab-item" title="新增服务" @click="runFabAction(openAddModal)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <button class="icon-btn fab-item" title="设置" @click="runFabAction(() => { showSettingsModal = true })">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button v-if="!authed" class="icon-btn fab-item" title="登录 / 注册" @click="runFabAction(() => { showAuthModal = true })">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
          <button v-else class="icon-btn fab-item fab-user-dot" :title="userEmail" @click="runFabAction(() => { userMenuOpen = !userMenuOpen })">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
        </div>
      </transition>
      <button
        class="fab fab-main"
        :class="{ open: fabMenuOpen }"
        :title="fabMenuOpen ? '收起菜单' : '展开菜单'"
        @click.stop="toggleFabMenu"
      >
        <span class="h-line"></span>
        <span class="h-line"></span>
        <span class="h-line"></span>
      </button>
    </div>

    <!-- Logged-in user menu -->
    <transition name="menu-pop">
      <div v-if="userMenuOpen" class="user-menu" @click.stop>
        <div class="user-menu-head">
          <span class="user-avatar">{{ userEmail.charAt(0).toUpperCase() }}</span>
          <div class="user-meta">
            <b>{{ userEmail }}</b>
            <span>偏好自动同步已开启</span>
          </div>
        </div>
        <button class="user-menu-item" :disabled="syncingNow" @click="syncNow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          {{ syncingNow ? '同步中…' : '立即同步' }}
        </button>
        <button v-if="isAdmin" class="user-menu-item" @click="openAdmin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          用户管理
        </button>
        <button class="user-menu-item" @click="openAccount">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
          </svg>
          账号管理
        </button>
        <button class="user-menu-item danger" @click="doLogout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          退出登录
        </button>
      </div>
    </transition>
  </div>

  <EditModal
    v-if="config"
    :visible="showEditModal"
    :services="config.services"
    :edit-index="editingIndex"
    @close="closeEditModal"
    @saved="saveConfig"
  />

  <SettingsModal
    v-if="config"
    :visible="showSettingsModal"
    :background="config.background"
    @close="showSettingsModal = false"
    @saved="saveConfig"
  />

  <PasswordModal
    :visible="showPasswordModal"
    @verified="onPasswordVerified"
    @cancel="onPasswordCancel"
  />

  <AuthModal
    :visible="showAuthModal"
    @authed="onAuthed"
    @close="showAuthModal = false"
  />

  <AccountModal
    :visible="showAccountModal"
    @close="showAccountModal = false"
    @deleted="onAccountDeleted"
  />

  <AdminModal
    :visible="showAdminModal"
    @close="showAdminModal = false"
  />

  <Toast :message="toastMessage" :visible="toastVisible" />

  <footer class="version-bar">Build · {{ buildTime }}</footer>
</template>
