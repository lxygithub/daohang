<script setup>
import { ref, watch, computed, inject } from 'vue'
import ImageCropper from './ImageCropper.vue'
import { probeImageBed, uploadImage } from '../composables/sync'

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
const group = ref('')
const iconUrl = ref('')
const faviconPreview = ref('')
const fetchingFavicon = ref(false)
const cropFile = ref(null)
const showCropper = ref(false)
// 自建图床：已配置时上传图标自动转外链；未配置/失败回退 base64 内联（原行为）
const imgbedEnabled = ref(false)
const uploadingIcon = ref(false)
const nameTouched = ref(false)
let autoFetchTimer = null
let skipAutoUrl = ''
let lastNameAuto = ''

const isEditing = computed(() => props.editIndex >= 0)
const modalTitle = computed(() => isEditing.value ? '编辑项目' : '新增项目')

// 分组选项（去重）
const groupOptions = computed(() => {
  const set = new Set()
  for (const s of props.services) {
    const g = (s.group || '').trim()
    if (g) set.add(g)
  }
  return [...set]
})

watch(() => props.visible, (val) => {
  if (!val) return
  faviconPreview.value = ''
  probeImageBed().then(v => { imgbedEnabled.value = v })
  nameTouched.value = false
  lastNameAuto = ''
  clearTimeout(autoFetchTimer)
  if (props.editIndex >= 0) {
    const svc = props.services[props.editIndex]
    if (svc) {
      name.value = svc.name
      url.value = svc.url
      skipAutoUrl = svc.url
      group.value = svc.group || ''
      iconUrl.value = svc.iconType === 'url' ? svc.icon : ''
      if (iconUrl.value) faviconPreview.value = iconUrl.value
    }
  } else {
    name.value = ''
    url.value = ''
    skipAutoUrl = ''
    group.value = ''
  }
})

// 输入链接后自动获取标题 + 图标（防抖，静默）
watch(url, (val) => {
  if (val.trim() === skipAutoUrl) return
  clearTimeout(autoFetchTimer)
  const u = val.trim()
  if (!u || !parseDomain(u)) return
  autoFetchTimer = setTimeout(() => autoFetch(true), 800)
})

function parseDomain(u) {
  try {
    const d = new URL(u.includes('://') ? u : 'https://' + u)
    return d.hostname
  } catch { return '' }
}

async function fetchFavicon() {
  return autoFetch(false)
}

// 自动获取：标题 + 图标一次拿齐（silent=true 时由防抖触发，不弹提示）
async function autoFetch(silent = false) {
  const u = url.value.trim()
  if (!u || !parseDomain(u)) {
    if (!silent) showToast('请先填写正确的链接')
    return
  }
  const normalized = u.includes('://') ? u : 'https://' + u
  fetchingFavicon.value = true
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    const res = await fetch(`/api/meta?url=${encodeURIComponent(normalized)}`, { signal: ctrl.signal })
    clearTimeout(timer)
    const data = await res.json()

    let got = false
    if (data.title && (!name.value.trim() || name.value === lastNameAuto)) {
      name.value = data.title
      lastNameAuto = data.title
      got = true
    }
    if (data.icon) {
      iconUrl.value = data.icon
      faviconPreview.value = data.icon
      got = true
    }
    if (!silent) {
      showToast(got ? '已自动填充' : '未能获取，可手动填写')
    }
  } catch {
    if (!silent) showToast('获取失败，请手动填写')
  } finally {
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

async function onCropDone(dataUrl) {
  showCropper.value = false
  cropFile.value = null
  // 未配置图床：沿用内联 base64（原行为，无需登录）
  if (!imgbedEnabled.value) {
    iconUrl.value = dataUrl
    faviconPreview.value = dataUrl
    return
  }
  // 已配置图床：上传换外链，失败回退内联，绝不阻断保存
  uploadingIcon.value = true
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], 'icon.png', { type: blob.type || 'image/png' })
    const r = await uploadImage(file)
    if (r.ok && r.url) {
      iconUrl.value = r.url
      faviconPreview.value = r.url
      showToast('图标已上传图床')
    } else {
      iconUrl.value = dataUrl
      faviconPreview.value = dataUrl
      showToast((r.error || '图床上传失败') + '，已改用内联保存')
    }
  } catch {
    iconUrl.value = dataUrl
    faviconPreview.value = dataUrl
    showToast('图床上传失败，已改用内联保存')
  } finally {
    uploadingIcon.value = false
  }
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
  const g = group.value.trim()
  if (g) svc.group = g

  if (iu) {
    // 自动获取或用户上传的图标
    svc.iconType = 'url'
    svc.icon = iu
  }
  // 没有图标 → 不写入图标字段，列表以纯色背景文字图标展示

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
        <label>链接 <span class="label-hint">（粘贴后自动识别名称与图标）</span></label>
        <div class="input-row">
          <input type="text" class="form-input" v-model="url" placeholder="粘贴链接，如 github.com">
          <button
            class="btn-text fetch-btn"
            :class="{ loading: fetchingFavicon }"
            @click="autoFetch(false)"
            :disabled="fetchingFavicon"
          >{{ fetchingFavicon ? '获取中…' : '自动获取' }}</button>
        </div>
      </div>
      <div class="form-group">
        <label>名称</label>
        <input type="text" class="form-input" v-model="name" placeholder="服务名称" @input="nameTouched = true">
      </div>
      <div class="form-group">
        <label>分组 <span class="label-hint">（可选，同组服务归类显示）</span></label>
        <input
          type="text"
          class="form-input"
          v-model="group"
          list="group-options"
          placeholder="如：开发工具 / 媒体 / 网络"
        >
        <datalist id="group-options">
          <option v-for="g in groupOptions" :key="g" :value="g" />
        </datalist>
      </div>
      <div class="form-group">
        <label>图标 <span class="label-hint">（未选择时显示纯色背景文字图标）</span></label>
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
