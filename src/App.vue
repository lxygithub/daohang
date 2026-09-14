<script setup>
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import { useConfig, getStoredPassword, AUTH_KEY } from './composables/useConfig'
import { useToast } from './composables/useToast'
import { loadView, saveView, emitView } from './composables/usePrefs'
import NavGrid from './components/NavGrid.vue'
import EditModal from './components/EditModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import PasswordModal from './components/PasswordModal.vue'
import Toast from './components/Toast.vue'

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
}

// Clock & greeting
const timeText = ref('')
const secText = ref('')
const dateText = ref('')
const greeting = ref('')
const quote = ref(null)
const quoteLoading = ref(false)

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

  const h = now.getHours()
  if (h < 5) greeting.value = '夜深了'
  else if (h < 9) greeting.value = '早上好'
  else if (h < 12) greeting.value = '上午好'
  else if (h < 14) greeting.value = '中午好'
  else if (h < 18) greeting.value = '下午好'
  else greeting.value = '晚上好'
}

// ---- Search engines ----
const ENGINES = [
  { id: 'local', name: '本地', hint: '搜索服务…', url: '' },
  { id: 'baidu', name: '百度', hint: '百度一下…', url: 'https://www.baidu.com/s?wd={q}' },
  { id: 'bing', name: '必应', hint: '必应搜索…', url: 'https://www.bing.com/search?q={q}' },
  { id: 'google', name: 'Google', hint: 'Google 搜索…', url: 'https://www.google.com/search?q={q}' },
  { id: 'sogou', name: '搜狗', hint: '搜狗搜索…', url: 'https://www.sogou.com/web?query={q}' },
  { id: 'ddg', name: 'DuckDuckGo', hint: 'DuckDuckGo 搜索…', url: 'https://duckduckgo.com/?q={q}' },
]
const ENGINE_KEY = 'nav_engine'
const engineId = ref(localStorage.getItem(ENGINE_KEY) || 'local')
const engine = computed(() => ENGINES.find(e => e.id === engineId.value) || ENGINES[0])
const showEngineMenu = ref(false)

function selectEngine(id) {
  engineId.value = id
  showEngineMenu.value = false
  try { localStorage.setItem(ENGINE_KEY, id) } catch {}
  searchInputRef.value?.focus()
}

// Keyboard shortcut: "/" focuses search
function handleKeydown(e) {
  if (e.key === 'Escape') {
    if (editMode.value) { editMode.value = false; return }
    showEngineMenu.value = false
    return
  }
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
  e.preventDefault()
  searchInputRef.value?.focus()
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

function setEditMode(v) {
  editMode.value = v
}

function handleDocClick(e) {
  // Close engine menu when clicking outside
  if (showEngineMenu.value && !e.target.closest('.engine-anchor')) {
    showEngineMenu.value = false
  }
  if (!editMode.value) return
  // Clicking a card or inside a modal keeps edit mode; blank space exits.
  if (e.target.closest('.card') || e.target.closest('.modal-overlay') || e.target.closest('.fab')) return
  editMode.value = false
}

// Password verification
const verified = ref(false)
const showPasswordModal = ref(false)
const pendingAction = ref(null)

function ensureVerified(callback) {
  if (verified.value) {
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

// Settings modal
const showSettingsModal = ref(false)

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
  // 会话内记住验证状态，刷新无需重复输密码
  if (getStoredPassword()) verified.value = true
  let savedLight = false
  try { savedLight = localStorage.getItem(THEME_KEY) === 'light' } catch {}
  applyTheme(savedLight)
  fetchQuote()
  await loadConfig()
  applyBackground()
})

let clockTimer = null

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('apply-background', applyBackground)
  window.removeEventListener('click', handleDocClick, true)
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

  <!-- Topbar -->
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
          </svg>
        </span>
        <span class="brand-name">导航</span>
      </div>
      <div class="topbar-actions">
        <button class="icon-btn" :title="viewMode === 'alpha' ? '切换到网格视图' : '切换到字母视图'" @click="toggleViewMode">
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
        <button class="icon-btn" :title="isLight ? '切换到暗色' : '切换到亮色'" @click="toggleTheme">
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
        <button class="icon-btn" title="新增服务" @click="openAddModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <button class="icon-btn" title="设置" @click="showSettingsModal = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- Page -->
  <main class="page">
    <section class="hero">
      <div class="clock">
        <span class="clock-time">{{ timeText }}</span>
        <span class="clock-sec">{{ secText }}</span>
      </div>
      <div class="hero-meta">
        <span>{{ dateText }}</span>
        <span class="sep">·</span>
        <span class="greeting">{{ greeting }}</span>
      </div>
      <form autocomplete="off" class="search-box" @submit.prevent>
        <div class="engine-anchor">
          <button type="button" class="engine-btn" :title="`搜索引擎：${engine.name}`" @click.stop="showEngineMenu = !showEngineMenu">
            <span class="engine-dot" v-if="engine.id !== 'local'"></span>{{ engine.name }}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <transition name="menu-pop">
            <div v-if="showEngineMenu" class="engine-menu" @click.stop>
              <button
                v-for="e in ENGINES"
                :key="e.id"
                type="button"
                class="engine-item"
                :class="{ active: e.id === engineId }"
                @click="selectEngine(e.id)"
              >
                <span>{{ e.name }}</span>
                <svg v-if="e.id === engineId" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
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
        >
        <kbd v-if="!searchQuery">/</kbd>
      </form>
      <div
        v-if="quote"
        class="quote"
        title="点击换一句"
        @click="fetchQuote"
      >
        <span class="quote-text">「{{ quote.text }}」</span>
        <span v-if="quote.from" class="quote-from">—— {{ quote.from }}</span>
      </div>
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
      :filter="searchQuery"
      :view="viewMode"
      @reordered="saveConfig"
    />
  </main>

  <!-- Windmill FAB — random Bing wallpaper -->
  <button
    class="fab"
    :class="{ loading: fabLoading }"
    title="随机壁纸（Bing 每日图）"
    @click.stop="randomWallpaper"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 12c-2 0-3.5-1.5-3.5-3.5S10 5 12 5V12z" fill="currentColor" stroke="none" opacity="0.9"/>
      <path d="M12 12c0 2-1.5 3.5-3.5 3.5S5 14 5 12H12z" fill="currentColor" stroke="none" opacity="0.65"/>
      <path d="M12 12c2 0 3.5 1.5 3.5 3.5S14 19 12 19V12z" fill="currentColor" stroke="none" opacity="0.9"/>
      <path d="M12 12c0-2 1.5-3.5 3.5-3.5S19 10 19 12H12z" fill="currentColor" stroke="none" opacity="0.65"/>
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>
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

  <Toast :message="toastMessage" :visible="toastVisible" />

  <footer class="version-bar">Build · {{ buildTime }}</footer>
</template>
