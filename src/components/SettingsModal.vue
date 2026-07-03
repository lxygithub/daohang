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

function close() {
  const custom = customValue.value.trim()
  if (custom) {
    ensureVerified(() => {
      document.body.style.background = custom
      props.background.type = 'color'
      props.background.value = custom
      emit('saved')
    })
  }
  emit('close')
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) close()
}
</script>

<template>
  <div class="modal-overlay" :class="{ active: visible }" @click="handleOverlayClick">
    <div class="modal">
      <h2>设置</h2>
      <div class="form-group">
        <label>背景</label>
        <div class="bg-presets">
          <div
            v-for="bg in BG_PRESETS"
            :key="bg.value"
            class="bg-preset-item"
            :class="{ selected: background && background.value === bg.value }"
            :style="{ background: bg.value }"
            :title="bg.name"
            @click="selectPreset(bg)"
          ></div>
        </div>
        <input type="text" class="form-input" v-model="customValue" placeholder="自定义颜色值：#222 或渐变函数">
      </div>
      <div class="modal-footer">
        <button class="btn-text cancel" @click="close">关闭</button>
      </div>
    </div>
  </div>
</template>
