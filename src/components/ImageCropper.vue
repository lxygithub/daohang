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
    minCropBoxWidth: 300,
    minCropBoxHeight: 300,
    initialCover: 'cover',
    background: false,
    responsive: false,
  })
}

function confirm() {
  if (!cropper) return

  // Force crop to fill the 300×300 visible area
  const canvas = cropper.getCroppedCanvas({
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    fillColor: 'transparent',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  })

  canvas.toBlob(blob => {
    const reader = new FileReader()
    reader.onload = () => emit('crop', reader.result)
    reader.readAsDataURL(blob)
  }, 'image/png')
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
