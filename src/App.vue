<script setup>
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import { useConfig } from './composables/useConfig'
import { useToast } from './composables/useToast'
import NavGrid from './components/NavGrid.vue'
import EditModal from './components/EditModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import PasswordModal from './components/PasswordModal.vue'
import Toast from './components/Toast.vue'

const { config, loading, loadConfig, saveConfig } = useConfig()
const { message: toastMessage, visible: toastVisible, showToast } = useToast()

const searchQuery = ref('')

// Clock
const clockText = ref('')
let clockTimer = null

function updateClock() {
  const now = new Date()
  const d = now.toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  })
  const t = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  clockText.value = `${d} ${t}`
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

function onPasswordVerified() {
  verified.value = true
  showPasswordModal.value = false
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
  await loadConfig()
  applyBackground()
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <header class="header">
    <div class="header-left">
      <h1>导航</h1>
      <div class="clock">{{ clockText }}</div>
    </div>
    <div class="header-actions">
      <input
        type="text"
        class="search-input"
        v-model="searchQuery"
        placeholder="搜索..."
        autocomplete="off"
      >
      <button class="btn" title="新增" @click="openAddModal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
      <button class="btn" title="设置" @click="showSettingsModal = true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>
  </header>

  <main class="main-content">
    <div v-if="loading" style="text-align:center;padding:60px 0;color:#666">加载中...</div>
    <div v-else-if="!config" style="text-align:center;padding:60px 0;color:#666">加载失败</div>
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
</template>
