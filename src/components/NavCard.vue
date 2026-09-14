<script setup>
import { computed, inject, ref } from 'vue'
import { ICONS } from '../data/icons'

const props = defineProps({
  service: { type: Object, required: true },
  index: { type: Number, required: true },
})

const emit = defineEmits(['open'])
const openEditModal = inject('openEditModal')
const editMode = inject('editMode', ref(false))
const setEditMode = inject('setEditMode', () => {})

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

// ---- click: open service / in edit mode open editor ----
// suppressNextClick: the click right after a long-press that fired edit mode
// belongs to the same gesture and must be swallowed.
let suppressNextClick = false

function handleClick(e) {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  if (editMode.value) {
    e.stopPropagation()
    openEditModal(props.index)
    return
  }
  emit('open')
}

function handleEdit(e) {
  e.stopPropagation()
  openEditModal(props.index)
}

function handleDelete(e) {
  e.stopPropagation()
  const event = new CustomEvent('delete-service', { detail: { index: props.index } })
  window.dispatchEvent(event)
}

// ---- long-press → edit mode (mouse & touch) ----
let pressTimer = null
let pressStart = null

function fireEditMode() {
  suppressNextClick = true
  setEditMode(true)
  if (navigator.vibrate) navigator.vibrate(20)
}

function cancelPress() {
  clearTimeout(pressTimer)
  pressTimer = null
}

function handleMouseDown(e) {
  suppressNextClick = false
  if (editMode.value) return // edit mode: HTML5 drag covers desktop reorder
  if (e.button !== 0) return
  pressStart = { x: e.clientX, y: e.clientY }
  clearTimeout(pressTimer)
  pressTimer = setTimeout(fireEditMode, 480)
}

function handleMouseMove(e) {
  if (!pressStart || pressTimer === null) return
  if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 6) cancelPress()
}

function handleMouseUp() {
  cancelPress()
  pressStart = null
}

// ---- Drag & Drop (HTML5, desktop) ----
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

// ---- Touch: long-press drag (mobile, edit mode) / long-press → edit mode ----
let touchDrag = null

function handleTouchStart(e) {
  if (e.touches.length !== 1) return
  suppressNextClick = false
  const t = e.touches[0]
  pressStart = { x: t.clientX, y: t.clientY }
  clearTimeout(pressTimer)
  if (editMode.value) {
    // Edit mode: quick long-press starts drag-reorder
    const el = e.currentTarget
    pressTimer = setTimeout(() => {
      touchDrag = { el, over: null }
      el.classList.add('touch-dragging')
      if (navigator.vibrate) navigator.vibrate(15)
    }, 200)
  } else {
    pressTimer = setTimeout(fireEditMode, 480)
  }
}

function handleTouchMove(e) {
  if (!touchDrag) {
    // moving cancels pending long-press
    if (pressStart && e.touches[0]) {
      const t = e.touches[0]
      if (Math.hypot(t.clientX - pressStart.x, t.clientY - pressStart.y) > 10) cancelPress()
    }
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
  pressStart = null
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
    :class="{ 'edit-mode': editMode }"
    :style="{ animationDelay: `${Math.min(index * 0.04, 0.5)}s` }"
    draggable="true"
    :data-index="index"
    :title="service.url"
    @click="handleClick"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @contextmenu.prevent
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

    <!-- Edit-mode overlay: delete top-right, edit center -->
    <template v-if="editMode">
      <button class="edit-badge edit-x" type="button" title="删除" @click.stop="handleDelete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <line x1="6" y1="6" x2="18" y2="18"/>
          <line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>
      <button class="edit-badge edit-pencil" type="button" title="编辑" @click.stop="handleEdit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    </template>
  </div>
</template>
