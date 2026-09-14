<script setup>
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import { useConfig, getStoredPassword, AUTH_KEY } from './composables/useConfig'
import { useToast } from './composables/useToast'
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

// Clock & greeting
const timeText = ref('')
const secText = ref('')
const dateText = ref('')
const greeting = ref('')

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

// Keyboard shortcut: "/" focuses search
function handleKeydown(e) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
  e.preventDefault()
  searchInputRef.value?.focus()
}

// Enter in search: URL → open directly, otherwise → open first match
function handleSearchEnter() {
  const q = searchQuery.value.trim()
  if (!q) return
  if (/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(q)) {
    window.open(q.includes('://') ? q : 'https://' + q, '_blank')
    return
  }
  window.dispatchEvent(new CustomEvent('open-first-match'))
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

// Background
function applyBackground() {
  if (config.value?.background) {
    document.body.style.background = config.value.background.value
  }
}

// Provide shared state to children
provide('config', config)
provide('saveConfig', saveConfig)
provide('showToast', showToast)
provide('ensureVerified', ensureVerified)
provide('openEditModal', openEditModal)

onMounted(async () => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
  window.addEventListener('keydown', handleKeydown)
  // 会话内记住验证状态，刷新无需重复输密码
  if (getStoredPassword()) verified.value = true
  await loadConfig()
  applyBackground()
})

let clockTimer = null

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref="searchInputRef"
          type="text"
          v-model="searchQuery"
          placeholder="搜索服务…"
          readonly
          @focus="e => e.target.removeAttribute('readonly')"
          @blur="e => !e.target.value && e.target.setAttribute('readonly', '')"
          @keydown.enter="handleSearchEnter"
        >
        <kbd v-if="!searchQuery">/</kbd>
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
      :filter="searchQuery"
      @reordered="saveConfig"
    />
  </main>

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
