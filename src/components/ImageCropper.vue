<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import Cropper from 'cropperjs'

const props = defineProps({
  file: { type: File, default: null },
})

const emit = defineEmits(['crop', 'cancel'])

const OUTPUT_SIZE = 128
const imgRef = ref(null)
const imageUrl = ref('')
let cropper = null

onMounted(() => {
  if (props.file) {
    imageUrl.value = URL.createObjectURL(props.file)
  }
})

onUnmounted(() => {
  if (cropper) cropper.destroy()
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

function onImgLoad() {
  if (cropper) cropper.destroy()
  const img = imgRef.value
  if (!img) return

  cropper = new Cropper(img, {
    aspectRatio: 1,
    viewMode: 1,
    dragMode: 'move',
    cropBoxMovable: false,
    cropBoxResizable: false,
    zoomable: true,
    scalable: false,
    rotatable: false,
    toggleDragModeOnDblclick: false,
    initialCover: 'cover',
    background: false,
  })
}

function confirm() {
  if (!cropper || !imageUrl.value) return

  // cropperjs v2 API: getCropperSelection() has x/y/width/height
  // in the canvas coordinate space. Use DOM bounding rects against
  // the original image to compute natural-image crop coordinates.
  const sel = cropper.getCropperSelection()
  const imgComponent = cropper.getCropperImage()
  if (!sel || !sel.width || !sel.height || !imgComponent) return

  const imgEl = imgComponent.$image  // native HTMLImageElement
  if (!imgEl) return

  const selRect = sel.getBoundingClientRect()
  const imgRect = imgEl.getBoundingClientRect()

  const scaleX = imgEl.naturalWidth / imgRect.width
  const scaleY = imgEl.naturalHeight / imgRect.height

  const x = (selRect.left - imgRect.left) * scaleX
  const y = (selRect.top - imgRect.top) * scaleY
  const w = selRect.width * scaleX
  const h = selRect.height * scaleY

  const src = new Image()
  src.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(src, x, y, w, h, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    emit('crop', canvas.toDataURL('image/png'))
  }
  src.src = imageUrl.value
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) emit('cancel')
}
</script>

<template>
  <div class="modal-overlay active" @click="handleOverlayClick">
    <div class="modal cropper-modal">
      <h2>裁剪图标</h2>
      <p class="crop-hint">拖拽移动，滚轮缩放</p>

      <div class="crop-viewport">
        <img
          v-if="imageUrl"
          ref="imgRef"
          :src="imageUrl"
          @load="onImgLoad"
          draggable="false"
        >
      </div>

      <div class="modal-footer">
        <button class="btn-text cancel" @click="emit('cancel')">取消</button>
        <button class="btn-text primary" @click="confirm">确认</button>
      </div>
    </div>
  </div>
</template>
