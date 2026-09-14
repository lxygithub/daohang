<script setup>
import { ref, watch, inject } from 'vue'
import { BG_PRESETS } from '../data/presets'

const props = defineProps({
  visible: Boolean,
  background: { type: Object, default: null },
})

const emit = defineEmits(['close', 'saved'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')
const configRef = inject('config')
const saveConfig = inject('saveConfig')

const customValue = ref('')
const SORT_KEY = 'nav_sort_usage'
const sortUsage = ref(localStorage.getItem(SORT_KEY) === '1')

watch(() => props.visible, (val) => {
  if (val && props.background) {
    customValue.value = props.background.value || ''
  }
})

function selectPreset(bg) {
  ensureVerified(() => {
    document.body.style.background = bg.value
    props.background.type = 'color'
    props.background.value = bg.value
    customValue.value = ''
    emit('saved')
  })
}

function resetDefault() {
  ensureVerified(() => {
    document.body.style.background = '#0d1017'
    props.background.type = 'color'
    props.background.value = '#0d1017'
    customValue.value = ''
    emit('saved')
    showToast('已恢复默认背景')
  })
}

function confirm() {
  const custom = customValue.value.trim()
  ensureVerified(() => {
    if (custom) {
      document.body.style.background = custom
      props.background.type = 'color'
      props.background.value = custom
    }
    emit('saved')
    emit('close')
  })
}

// ---- 使用频率排序 ----
function onSortUsageChange() {
  localStorage.setItem(SORT_KEY, sortUsage.value ? '1' : '0')
  window.dispatchEvent(new CustomEvent('usage-sort-changed', { detail: sortUsage.value }))
}

// ---- 导入 / 导出 ----
function exportConfig() {
  const cfg = configRef?.value
  if (!cfg) return
  const data = {
    app: 'daohang',
    version: 2,
    exportedAt: new Date().toISOString(),
    services: cfg.services || [],
    background: cfg.background || null,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  a.href = url
  a.download = `nav-config-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast('配置已导出')
}

function pickImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!Array.isArray(data.services)) {
        showToast('文件格式不正确')
        return
      }
      ensureVerified(() => {
        const cfg = configRef?.value
        if (!cfg) return
        cfg.services = data.services.filter(s => s && s.name && s.url)
        if (data.background && typeof data.background === 'object') {
          cfg.background = data.background
          document.body.style.background = data.background.value || ''
        }
        saveConfig()
        showToast(`已导入 ${cfg.services.length} 个服务`)
        emit('close')
      })
    } catch {
      showToast('导入失败，请检查文件')
    }
  }
  input.click()
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) return
}
</script>

<template>
  <div class="modal-overlay" :class="{ active: visible }" @click="handleOverlayClick">
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <h2>设置</h2>
        <button class="modal-close" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="form-group">
        <label>背景</label>
        <div class="bg-presets">
          <div
            v-for="bg in BG_PRESETS"
            :key="bg.value"
            class="bg-preset-item"
            :class="{ selected: background && background.value === bg.value }"
            :title="bg.name"
            @click="selectPreset(bg)"
          >
            <div class="bg-preset-swatch" :style="{ background: bg.value }"></div>
            <div class="bg-preset-name">{{ bg.name }}</div>
          </div>
        </div>
        <input type="text" class="form-input" v-model="customValue" placeholder="自定义背景：#222 或 linear-gradient(...)">
        <p class="settings-hint">点击预设立即生效，支持任意颜色值与 CSS 渐变</p>
      </div>

      <div class="form-group">
        <label>排序</label>
        <label class="switch-row">
          <span class="switch-label">按使用频率排序<span class="label-hint">（本机生效，开启后忽略手动排序）</span></span>
          <input type="checkbox" v-model="sortUsage" @change="onSortUsageChange">
          <span class="switch" aria-hidden="true"></span>
        </label>
      </div>

      <div class="form-group">
        <label>备份</label>
        <div class="backup-row">
          <button class="btn-text ghost" @click="exportConfig">导出配置</button>
          <button class="btn-text ghost" @click="pickImport">导入配置</button>
        </div>
        <p class="settings-hint">导出包含全部服务与背景设置，导入将覆盖当前数据</p>
      </div>

      <div class="modal-footer">
        <button class="btn-text ghost" @click="resetDefault">恢复默认</button>
        <button class="btn-text primary" @click="confirm">确定</button>
      </div>
    </div>
  </div>
</template>
