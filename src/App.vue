<script setup>
import { ref, computed, onMounted, onUnmounted, provide, watch } from 'vue'
// 本地缓存：冷启动先渲染上次配置，避免等三次网关往返（每次 ≈2.5s）才出首屏
import { useConfig, primeConfigFromCache, clearConfigCache } from './composables/useConfig'
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
import BuiltinModal from './components/BuiltinModal.vue'
import SearchModal from './components/SearchModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import AuthModal from './components/AuthModal.vue'
import AccountModal from './components/AccountModal.vue'
import AdminModal from './components/AdminModal.vue'
import Toast from './components/Toast.vue'
import {
  authed, authChecked, checkAuth, pullAndMerge, logout as syncLogout,
  bindPrefEvents,
} from './composables/sync'
const buildTime = __BUILD_TIME__

const { config, loading, loadConfig, saveConfig } = useConfig()
const { message: toastMessage, visible: toastVisible, showToast } = useToast()

watch(authed, loggedIn => {
  if (loggedIn) return
  config.value = null
  editMode.value = false
  applyBackground()
  if (!loading.value) showAuthModal.value = true
})

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
// dismissed：用户按 Esc 或点了别处就收起来（之前只能清空输入才消失，等于关不掉）
const suggestDismissed = ref(false)
const showSuggestions = computed(() =>
  searchPrefs.value.suggestions &&
  !searchPrefs.value.hidden &&
  !suggestDismissed.value &&
  searchQuery.value.trim().length > 0
)

// 重新输入 → 允许再次弹出
watch(searchQuery, () => { suggestDismissed.value = false })

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

// Keyboard shortcuts: Ctrl/Cmd+F → fullscreen icon search; "/" focuses search
function handleKeydown(e) {
  // Ctrl+F / Cmd+F：全屏搜索已添加站点（覆盖浏览器默认查找，再按一次关闭）
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    showSearchModal.value = !showSearchModal.value
    return
  }
  // Ctrl+K / Cmd+K：新增站点（不用再去右上角找）
  // Ctrl+I / Cmd+I：打开设置
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    if (config.value) openAddModal()
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'i' || e.key === 'I')) {
    e.preventDefault()
    if (config.value) showSettingsModal.value = true
    return
  }
  if (e.key === 'Escape') {
    if (showSuggestions.value) { suggestDismissed.value = true; return }
    if (showSearchModal.value) { showSearchModal.value = false; return }
    if (showSettingsModal.value) { showSettingsModal.value = false; return }
    if (editMode.value) { editMode.value = false; return }
    if (addingEngine.value) { addingEngine.value = false; return }
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
  // 点搜索框以外的任何地方，把联想条收起来
  if (showSuggestions.value && !e.target.closest('.search-box')) {
    suggestDismissed.value = true
  }
  if (!editMode.value) return
  // Clicking a card or inside a modal keeps edit mode; blank space exits.
  if (
    e.target.closest('.card') ||
    e.target.closest('.modal-overlay') ||
    e.target.closest('.settings-drawer') ||
    e.target.closest('.drawer-catch') ||
    e.target.closest('.gear-fab')
  ) return
  editMode.value = false
}

function ensureVerified(callback) {
  if (authed.value) {
    callback()
    return
  }
  showToast('请先登录')
  showAuthModal.value = true
}

// Edit modal
const showEditModal = ref(false)
const editingIndex = ref(-1)
const showBuiltinModal = ref(false)
// 全屏搜索图标弹窗（Ctrl+F / FAB 菜单「搜索图标」）
const showSearchModal = ref(false)

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
const syncingNow = ref(false)

async function onAuthed(mail, mode) {
  showToast(mode === 'register' ? '注册成功，正在获取云端数据…' : '登录成功，正在获取云端数据…')
  await pullAndMerge()
  const loaded = await loadConfig()
  if (loaded) applyBackground()
  else showAuthModal.value = true
}

async function doLogout() {
  await syncLogout()
  showToast('已退出登录')
  clearConfigCache()   // 换账号/登出后不得再渲染上一账号的缓存配置
  config.value = null
  showSettingsModal.value = false
  showAuthModal.value = true
}

function openAccount() {
  showAccountModal.value = true
}

function openAdmin() {
  showAdminModal.value = true
}

async function onAccountDeleted() {
  showToast('账号已注销，云端数据已清除')
  config.value = null
  showAuthModal.value = true
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
  }
}

// ---- 右上角只留一个淡化的齿轮 ----
// 原先那一排浮标（视图切换 / 明暗 / 新增 / 内置导航 / 图标搜索 / 设置 / 账号）太长，
// 已按用户要求全部搬进设置抽屉，右上角只保留「点一下直接开设置」的齿轮。

// ---- View mode (grid / alpha) ----
const viewMode = ref(loadView())

function toggleViewMode() {
  // 默认平铺 → 字母索引 → 按分组 → 默认平铺
  viewMode.value = viewMode.value === 'grid' ? 'alpha' : (viewMode.value === 'alpha' ? 'group' : 'grid')
  saveView(viewMode.value)
  emitView(viewMode.value)
}

function setViewMode(v) {
  if (!['grid', 'alpha', 'group'].includes(v)) return
  viewMode.value = v
  saveView(v)
  emitView(v)
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
  // 先用本地缓存出页面：三个网关往返（鉴权→偏好→配置，每次 ≈2.5s）不再阻塞首屏
  primeConfigFromCache()
  if (await checkAuth()) {
    // 偏好与配置互不依赖，并行拉取，少等一个往返
    await Promise.all([pullAndMerge(), loadConfig()])
    applyBackground()
    // 桌面图标长按菜单（manifest.shortcuts）走的是深链 /?action=search|library|add：
    // 处理完立刻清掉参数，避免刷新时重复弹出
    try {
      const act = new URLSearchParams(location.search).get('action')
      if (act) {
        history.replaceState(null, '', location.pathname + location.hash)
        if (act === 'search') showSearchModal.value = true
        else if (act === 'library') showBuiltinModal.value = true
        else if (act === 'add') openEditModal(-1)
      }
    } catch {}
  } else {
    clearConfigCache()
    config.value = null
    loading.value = false
    showAuthModal.value = true
  }
  // 入场动画（含最长 0.5s stagger + 0.45s 动画本身）播完后再摘除 .app-boot
  setTimeout(() => { appBooted.value = true }, 1100)
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
              <kbd class="suggest-key">↵</kbd>
            </button>
          </div>
        </transition>
      </form>
    </section>

    <!-- authed 初始为 false 只表示「还没问过服务端」，不能当成未登录来渲染。
         否则登录状态下刷新会先闪一下「请登录…」再跳回来（鉴权那趟网关往返 1～2s）。
         有本地缓存就直接出网格（缓存本来就是给首屏秒开用的），没缓存才转圈等鉴权。 -->
    <div v-if="loading || (!authChecked && !config)" class="state-wrap">
      <div class="spinner"></div>
      <div>正在加载…</div>
    </div>
    <div v-else-if="authChecked && !authed" class="state-wrap">
      <div>请登录后查看并同步你的导航数据</div>
      <button type="button" class="btn-text primary" @click="showAuthModal = true">登录 / 注册</button>
    </div>
    <div v-else-if="authChecked && !config" class="state-wrap">
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

  <!-- 右上角只剩一个淡化的齿轮：点一下直接开设置（其余动作都在设置抽屉里） -->
  <button
    v-if="config"
    class="gear-fab"
    title="设置（Ctrl+I）"
    aria-label="设置"
    @click.stop="showSettingsModal = true"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  </button>

  <EditModal
    v-if="config"
    :visible="showEditModal"
    :services="config.services"
    :edit-index="editingIndex"
    @close="closeEditModal"
    @saved="saveConfig"
  />

  <BuiltinModal
    v-if="config"
    :visible="showBuiltinModal"
    :services="config.services"
    @close="showBuiltinModal = false"
    @added="saveConfig"
  />

  <SearchModal
    :visible="showSearchModal"
    :services="config?.services || []"
    @close="showSearchModal = false"
  />

  <SettingsModal
    v-if="config"
    :visible="showSettingsModal"
    :background="config.background"
    :light="isLight"
    :syncing="syncingNow"
    :view="viewMode"
    @close="showSettingsModal = false"
    @saved="saveConfig"
    @add-site="openAddModal"
    @search-sites="showSearchModal = true"
    @builtin-library="showBuiltinModal = true"
    @toggle-theme="toggleTheme"
    @set-view="setViewMode"
    @login="showAuthModal = true"
    @account="openAccount"
    @admin="openAdmin"
    @logout="doLogout"
    @sync="syncNow"
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
