<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  file: { type: File, default: null },
})

const emit = defineEmits(['crop', 'cancel'])

const CROP_SIZE = 300
const OUTPUT_SIZE = 128

const imgRef = ref(null)
const viewportRef = ref(null)
const imageUrl = ref('')
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const startOffset = ref({ x: 0, y: 0 })
const naturalW = ref(0)
const naturalH = ref(0)

onMounted(() => {
  if (props.file) {
    imageUrl.value = URL.createObjectURL(props.file)
  }
})

onUnmounted(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

function onImgLoad(e) {
  const img = e.target
  naturalW.value = img.naturalWidth
  naturalH.value = img.naturalHeight
  // Initial zoom: fill crop square (cover mode)
  scale.value = Math.max(CROP_SIZE / img.naturalWidth, CROP_SIZE / img.naturalHeight)
  offsetX.value = 0
  offsetY.value = 0
}

// Center image initially: fit shortest side to crop box
function clampOffset() {
  const halfW = (naturalW.value * scale.value) / 2
  const halfH = (naturalH.value * scale.value) / 2
  const halfVp = CROP_SIZE / 2

  // Allow center to move within viewport; extra when image is larger
  const maxX = halfVp + Math.max(0, halfW - halfVp)
  const maxY = halfVp + Math.max(0, halfH - halfVp)

  offsetX.value = Math.min(maxX, Math.max(-maxX, offsetX.value))
  offsetY.value = Math.min(maxY, Math.max(-maxY, offsetY.value))
}

function onMouseDown(e) {
  dragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  startOffset.value = { x: offsetX.value, y: offsetY.value }
}

function onMouseMove(e) {
  if (!dragging.value) return
  offsetX.value = startOffset.value.x + (e.clientX - dragStart.value.x)
  offsetY.value = startOffset.value.y + (e.clientY - dragStart.value.y)
  clampOffset()
}

function onMouseUp() {
  dragging.value = false
}

function onWheel(e) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  scale.value = Math.max(0.3, Math.min(3, scale.value + delta))
  clampOffset()
}

function setZoom(v) {
  scale.value = Math.max(0.3, Math.min(3, Number(v)))
  nextTick(clampOffset)
}

function confirm() {
  if (!imgRef.value || !viewportRef.value) return

  const imgEl = imgRef.value
  const vp = viewportRef.value
  const vpRect = vp.getBoundingClientRect()
  const imgRect = imgEl.getBoundingClientRect()

  // Source coordinates in natural image space
  const sx = (vpRect.left - imgRect.left) / scale.value
  const sy = (vpRect.top - imgRect.top) / scale.value
  const sw = CROP_SIZE / scale.value
  const sh = CROP_SIZE / scale.value

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')

  // Draw the native Image object, not the element
  const natImg = new Image()
  natImg.onload = () => {
    ctx.drawImage(natImg, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    canvas.toBlob(blob => {
      const reader = new FileReader()
      reader.onload = () => emit('crop', reader.result)
      reader.readAsDataURL(blob)
    }, 'image/png')
  }
  natImg.src = imageUrl.value
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) emit('cancel')
}
</script>

<template>
  <div class="modal-overlay active" @click="handleOverlayClick">
    <div class="modal cropper-modal">
      <h2>裁剪图标</h2>

      <div
        ref="viewportRef"
        class="crop-viewport"
        :class="{ dragging }"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @wheel.prevent="onWheel"
      >
        <img
          v-if="imageUrl"
          ref="imgRef"
          :src="imageUrl"
          class="crop-image"
          :style="{
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
          }"
          @load="onImgLoad"
          draggable="false"
        >
      </div>

      <div class="crop-zoom">
        <input
          type="range"
          class="crop-slider"
          min="0.3"
          max="3"
          step="0.01"
          :value="scale"
          @input="setZoom($event.target.value)"
        >
        <span class="crop-zoom-label">{{ Math.round(scale * 100) }}%</span>
      </div>

      <div class="modal-footer">
        <button class="btn-text cancel" @click="emit('cancel')">取消</button>
        <button class="btn-text primary" @click="confirm">确认</button>
      </div>
    </div>
  </div>
</template>
