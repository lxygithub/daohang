<script setup>
import { ref, watch, computed, inject } from 'vue'
import { ICONS } from '../data/icons'

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

const isEditing = computed(() => props.editIndex >= 0)
const modalTitle = computed(() => isEditing.value ? '编辑项目' : '新增项目')

watch(() => props.visible, (val) => {
  if (!val) return
  if (props.editIndex >= 0) {
    const svc = props.services[props.editIndex]
    if (svc) {
      name.value = svc.name
      url.value = svc.url
      iconUrl.value = svc.iconType === 'url' ? svc.icon : ''
      selectedIcon.value = svc.iconType === 'preset' ? svc.icon : 'server'
    }
  } else {
    name.value = ''
    url.value = ''
    iconUrl.value = ''
    selectedIcon.value = 'server'
  }
})

function selectIcon(key) {
  selectedIcon.value = key
  iconUrl.value = ''
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
      <h2>{{ modalTitle }}</h2>
      <div class="form-group">
        <label>名称</label>
        <input type="text" class="form-input" v-model="name" placeholder="服务名称">
      </div>
      <div class="form-group">
        <label>链接</label>
        <input type="text" class="form-input" v-model="url" placeholder="https://...">
      </div>
      <div class="form-group">
        <label>图标</label>
        <div class="icon-picker-container">
          <div class="icon-picker-grid">
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
        </div>
        <div style="margin-top:10px">
          <input type="text" class="form-input" v-model="iconUrl" placeholder="或输入图片URL：https://...">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-text cancel" @click="emit('close')">取消</button>
        <button class="btn-text primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
