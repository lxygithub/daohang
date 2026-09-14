<script setup>
import { computed, inject } from 'vue'
import { ICONS } from '../data/icons'

const props = defineProps({
  service: { type: Object, required: true },
  index: { type: Number, required: true },
})

const emit = defineEmits(['open'])
const openEditModal = inject('openEditModal')

// Deterministic hue from service name → per-card icon tint
const hue = computed(() => {
  let h = 0
  for (const ch of props.service.name) {
    h = (h * 31 + (ch.codePointAt(0) || 0)) % 360
  }
  // Map to a pleasing range, avoid muddy yellows
  return (h * 7) % 360
})

// Host subtitle from url
const host = computed(() => {
  try {
    const u = new URL(
      props.service.url.includes('://') ? props.service.url : 'https://' + props.service.url
    )
    return u.hostname.replace(/^www\./, '') + (u.port ? ':' + u.port : '')
  } catch {
    return props.service.url
  }
})

function handleClick(e) {
  if (e.target.closest('.card-action-btn')) return
  emit('open')
}

function handleEdit(e) {
  e.stopPropagation()
  openEditModal(props.index)
}

function handleDelete(e) {
  e.stopPropagation()
  // Handled via provide/inject in parent
  const event = new CustomEvent('delete-service', { detail: { index: props.index } })
  window.dispatchEvent(event)
}

// Drag & Drop
function handleDragStart(e) {
  e.dataTransfer.setData('text/plain', String(props.index))
  e.dataTransfer.effectAllowed = 'move'
  e.target.classList.add('dragging')
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging')
  document.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'))
}

function handleDragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
}

function handleDragEnter(e) {
  e.preventDefault()
  e.currentTarget.classList.add('drag-over')
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over')
}

function handleDrop(e) {
  e.preventDefault()
  e.currentTarget.classList.remove('drag-over')
  const srcIndex = Number(e.dataTransfer.getData('text/plain'))
  const targetIndex = props.index
  if (srcIndex === targetIndex) return

  const event = new CustomEvent('drop-reorder', { detail: { srcIndex, targetIndex } })
  window.dispatchEvent(event)
}

// ---- Touch long-press drag (mobile) ----
let pressTimer = null
let touchDrag = null

function handleTouchStart(e) {
  if (e.touches.length !== 1) return
  const el = e.currentTarget
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    touchDrag = { el, over: null }
    el.classList.add('touch-dragging')
    if (navigator.vibrate) navigator.vibrate(15)
  }, 260)
}

function handleTouchMove(e) {
  if (!touchDrag) {
    clearTimeout(pressTimer)
    return
  }
  // 拖拽激活后阻止页面滚动
  e.preventDefault()
  const t = e.touches[0]
  const target = document.elementFromPoint(t.clientX, t.clientY)?.closest('.card')
  document.querySelectorAll('.card.touch-over').forEach(c => c.classList.remove('touch-over'))
  if (target && target !== touchDrag.el) {
    target.classList.add('touch-over')
    touchDrag.over = target
  } else {
    touchDrag.over = null
  }
}

function handleTouchEnd() {
  clearTimeout(pressTimer)
  if (touchDrag) {
    touchDrag.el.classList.remove('touch-dragging')
    const over = touchDrag.over
    if (over) {
      over.classList.remove('touch-over')
      const srcIndex = props.index
      const targetIndex = Number(over.dataset.index)
      if (srcIndex !== targetIndex && !Number.isNaN(targetIndex)) {
        window.dispatchEvent(new CustomEvent('drop-reorder', { detail: { srcIndex, targetIndex } }))
      }
    }
  }
  touchDrag = null
}
</script>

<template>
  <div
    class="card"
    :style="{ animationDelay: `${Math.min(index * 0.04, 0.5)}s` }"
    draggable="true"
    :data-index="index"
    :title="service.url"
    @click="handleClick"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @dragover="handleDragOver"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchEnd"
  >
    <div class="card-icon" :style="{ '--h': hue }">
      <img
        v-if="service.iconType === 'url' && service.icon"
        :src="service.icon"
        :alt="service.name"
      >
      <span v-else-if="service.iconType === 'emoji'" class="card-icon-emoji">{{ service.icon }}</span>
      <span v-else v-html="ICONS[service.icon] || ICONS.server"></span>
    </div>
    <div class="card-meta">
      <div class="card-name">{{ service.name }}</div>
      <div class="card-host">{{ host }}</div>
    </div>
    <div class="card-actions">
      <button class="card-action-btn" title="编辑" @click="handleEdit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="card-action-btn delete" title="删除" @click="handleDelete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  </div>
</template>
