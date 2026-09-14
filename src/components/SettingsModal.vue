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

const customValue = ref('')

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
      <div class="modal-footer">
        <button class="btn-text ghost" @click="resetDefault">恢复默认</button>
        <button class="btn-text primary" @click="confirm">确定</button>
      </div>
    </div>
  </div>
</template>
