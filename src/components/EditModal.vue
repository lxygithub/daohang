<script setup>
import { ref, watch, computed, inject } from 'vue'
import { ICONS, EMOJIS } from '../data/icons'
import ImageCropper from './ImageCropper.vue'

const props = defineProps({
  visible: Boolean,
  services: { type: Array, required: true },
  editIndex: { type: Number, default: -1 },
})

const emit = defineEmits(['close', 'saved'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')

const name = ref('')
const url = ref('')
const iconUrl = ref('')
const selectedIcon = ref('server')
const faviconPreview = ref('')
const fetchingFavicon = ref(false)
const cropFile = ref(null)
const showCropper = ref(false)
const iconMode = ref('svg')
const selectedEmoji = ref('')
const iconText = ref('')
const iconBgColor = ref('#3b82f6')
const textIconPreview = ref('')
const generatingText = ref(false)

const isEditing = computed(() => props.editIndex >= 0)
const modalTitle = computed(() => isEditing.value ? '编辑项目' : '新增项目')

watch(() => props.visible, (val) => {
  if (!val) return
  iconMode.value = 'svg'
  selectedEmoji.value = ''
  selectedIcon.value = 'server'
  iconText.value = ''
  iconBgColor.value = '#3b82f6'
  textIconPreview.value = ''
  faviconPreview.value = ''
  if (props.editIndex >= 0) {
    const svc = props.services[props.editIndex]
    if (svc) {
      name.value = svc.name
      url.value = svc.url
      iconUrl.value = svc.iconType === 'url' ? svc.icon : ''
      if (svc.iconType === 'emoji') {
        iconMode.value = 'emoji'
        selectedEmoji.value = svc.icon
      } else {
        selectedIcon.value = svc.iconType === 'preset' ? svc.icon : 'server'
      }
    }
  } else {
    name.value = ''
    url.value = ''
  }
})

function selectIcon(key) {
  selectedIcon.value = key
  selectedEmoji.value = ''
  iconUrl.value = ''
  textIconPreview.value = ''
  iconMode.value = 'svg'
}

function selectEmoji(e) {
  selectedEmoji.value = e
  selectedIcon.value = ''
  iconUrl.value = ''
  textIconPreview.value = ''
  iconMode.value = 'emoji'
}

function switchToText() {
  iconMode.value = 'text'
  selectedIcon.value = ''
  selectedEmoji.value = ''
  iconUrl.value = ''
  textIconPreview.value = ''
  // Auto-fill first char of name
  if (!iconText.value && name.value) {
    iconText.value = name.value.charAt(0).toUpperCase()
  }
}

function generateTextIcon() {
  const text = iconText.value.trim()
  if (!text) { showToast('请输入文字'); return }
  generatingText.value = true

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Rounded rect
  const r = 24
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(size - r, 0)
  ctx.quadraticCurveTo(size, 0, size, r)
  ctx.lineTo(size, size - r)
  ctx.quadraticCurveTo(size, size, size - r, size)
  ctx.lineTo(r, size)
  ctx.quadraticCurveTo(0, size, 0, size - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fillStyle = iconBgColor.value
  ctx.fill()

  // Text
  const fontSize = text.length > 2 ? 36 : text.length > 1 ? 52 : 64
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text.slice(0, 2), size / 2, size / 2)

  textIconPreview.value = canvas.toDataURL('image/png')
  iconUrl.value = textIconPreview.value
  generatingText.value = false
}

function parseDomain(u) {
  try {
    const d = new URL(u.includes('://') ? u : 'https://' + u)
    return d.hostname
  } catch { return '' }
}

async function fetchFavicon() {
  const u = url.value.trim()
  if (!u) { showToast('请先填写链接'); return }
  const domain = parseDomain(u)
  if (!domain) { showToast('链接格式不正确'); return }

  fetchingFavicon.value = true
  // Normalize URL — add protocol if missing
  const normalized = u.includes('://') ? u : 'https://' + u

  try {
    // Backend fetches page HTML, parses <link rel="icon">, falls back to /favicon.ico
    const res = await fetch(`/api/favicon?url=${encodeURIComponent(normalized)}`)
    const data = await res.json()

    if (!data.found || !data.url) {
      showToast('未找到图标，可上传自定义图标')
      fetchingFavicon.value = false
      return
    }

    // Verify loaded icon is not a 1x1 spacer
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth < 8 && img.naturalHeight < 8) {
        showToast('未找到图标，可上传自定义图标')
      } else {
        faviconPreview.value = data.url
        iconUrl.value = data.url
        selectedIcon.value = ''
      }
      fetchingFavicon.value = false
    }
    img.onerror = () => {
      showToast('未找到图标，可上传自定义图标')
      fetchingFavicon.value = false
    }
    img.src = data.url
  } catch {
    showToast('获取图标失败')
    fetchingFavicon.value = false
  }
}

function pickFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    if (input.files?.length) {
      cropFile.value = input.files[0]
      showCropper.value = true
    }
  }
  input.click()
}

function onCropDone(dataUrl) {
  iconUrl.value = dataUrl
  selectedIcon.value = ''
  faviconPreview.value = dataUrl
  showCropper.value = false
  cropFile.value = null
}

function onCropCancel() {
  showCropper.value = false
  cropFile.value = null
}

function save() {
  const n = name.value.trim()
  const u = url.value.trim()
  const iu = iconUrl.value.trim()

  if (!n || !u) {
    showToast('请填写名称和链接')
    return
  }

  const svc = {
    id: 'svc-' + Date.now(),
    name: n,
    url: u,
  }

  if (iu) {
    svc.iconType = 'url'
    svc.icon = iu
  } else if (iconMode.value === 'emoji' && selectedEmoji.value) {
    svc.iconType = 'emoji'
    svc.icon = selectedEmoji.value
  } else {
    svc.iconType = 'preset'
    svc.icon = selectedIcon.value
  }

  ensureVerified(() => {
    if (props.editIndex >= 0) {
      svc.id = props.services[props.editIndex].id
      props.services[props.editIndex] = svc
      showToast('已更新')
    } else {
      props.services.push(svc)
      showToast('已添加')
    }
    emit('saved')
    emit('close')
  })
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <div class="modal-overlay" :class="{ active: visible }" @click="handleOverlayClick">
    <div class="modal">
      <div class="modal-header">
        <h2>{{ modalTitle }}</h2>
        <button class="modal-close" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="form-group">
        <label>名称</label>
        <input type="text" class="form-input" v-model="name" placeholder="服务名称">
      </div>
      <div class="form-group">
        <label>链接</label>
        <div class="input-row">
          <input type="text" class="form-input" v-model="url" placeholder="https://...">
          <button
            class="btn-text fetch-btn"
            :class="{ loading: fetchingFavicon }"
            @click="fetchFavicon"
            :disabled="fetchingFavicon"
          >{{ fetchingFavicon ? '获取中…' : '图标' }}</button>
        </div>
      </div>
      <div class="form-group">
        <label>图标</label>
        <div class="icon-picker-container">
          <div class="icon-tabs">
            <button
              class="icon-tab"
              :class="{ active: iconMode === 'svg' }"
              @click="iconMode = 'svg'"
            >SVG</button>
            <button
              class="icon-tab"
              :class="{ active: iconMode === 'emoji' }"
              @click="iconMode = 'emoji'"
            >Emoji</button>
            <button
              class="icon-tab"
              :class="{ active: iconMode === 'text' }"
              @click="switchToText"
            >文字</button>
          </div>
          <div v-if="iconMode === 'svg'" class="icon-picker-grid">
            <div
              v-for="(svg, key) in ICONS"
              :key="key"
              class="icon-picker-item"
              :class="{ selected: selectedIcon === key && !iconUrl }"
              @click="selectIcon(key)"
            >
              <span v-html="svg"></span>
              <span>{{ key }}</span>
            </div>
          </div>
          <div v-else-if="iconMode === 'emoji'" class="emoji-picker-grid">
            <div
              v-for="e in EMOJIS"
              :key="e"
              class="emoji-picker-item"
              :class="{ selected: selectedEmoji === e }"
              @click="selectEmoji(e)"
            >{{ e }}</div>
          </div>
          <div v-else class="text-icon-config">
            <div class="text-icon-row">
              <label>文字</label>
              <input type="text" class="form-input" v-model="iconText" placeholder="A" maxlength="4" @input="iconText = iconText.slice(0,4)">
            </div>
            <div class="text-icon-row">
              <label>背景色</label>
              <div class="text-color-row">
                <input type="color" v-model="iconBgColor" class="color-input">
                <input type="text" class="form-input color-text" v-model="iconBgColor" maxlength="7">
              </div>
            </div>
            <button class="btn-text primary text-generate-btn" @click="generateTextIcon" :disabled="generatingText">
              {{ generatingText ? '生成中…' : '生成图标' }}
            </button>
            <div v-if="textIconPreview" class="text-icon-preview-wrap">
              <img :src="textIconPreview" class="text-icon-preview">
            </div>
          </div>
        </div>
        <div class="custom-icon-panel">
          <button class="btn-text upload-btn" @click="pickFile">上传图标</button>
          <input type="text" class="form-input" v-model="iconUrl" placeholder="或输入图片 URL">
          <img v-if="faviconPreview" :src="faviconPreview" class="favicon-preview" @error="faviconPreview = ''">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-text cancel" @click="emit('close')">取消</button>
        <button class="btn-text primary" @click="save">保存</button>
      </div>
    </div>
  </div>

  <ImageCropper
    v-if="showCropper && cropFile"
    :file="cropFile"
    @crop="onCropDone"
    @cancel="onCropCancel"
  />
</template>
