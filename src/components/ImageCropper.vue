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
  const data = cropper?.getData()
  if (!data || !imageUrl.value) return

  // Create fresh Image from blob URL to avoid preload race
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    ctx.drawImage(
      img,
      data.x, data.y, data.width, data.height,
      0, 0, OUTPUT_SIZE, OUTPUT_SIZE,
    )
    emit('crop', canvas.toDataURL('image/png'))
  }
  img.onerror = () => { /* silent — do nothing */ }
  img.src = imageUrl.value
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
