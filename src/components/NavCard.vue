<script setup>
import { computed, inject, ref, watch } from 'vue'
import { textIconChars } from '../utils/textIcon'

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

// ---- Solid-color text icon fallback ----
// Shown only when no icon was auto-fetched and the user hasn't uploaded one.
// Legacy emoji / preset icons render as text icons too (both pickers are gone).
// 图标 URL 加载失败（404/防盗链）也回退文字图标，避免破图挂在网上
const iconFailed = ref(false)
watch(() => props.service.icon, () => { iconFailed.value = false })

const isTextIcon = computed(() =>
  !props.service.icon ||
  iconFailed.value ||
  props.service.iconType === 'text' ||
  props.service.iconType === 'emoji' ||
  props.service.iconType === 'preset'
)

const textChar = computed(() => textIconChars(props.service.name))

// ---- click: open service / in edit mode open editor ----
// suppressNextClick: the click right after a touch long-press that fired edit
// mode belongs to the same gesture and must be swallowed.
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

// ---- right-click → edit mode (desktop); touch long-press covers mobile ----
function fireEditMode() {
  suppressNextClick = true
  setEditMode(true)
  if (navigator.vibrate) navigator.vibrate(20)
}

function handleContextMenu(e) {
  e.preventDefault()
  if (editMode.value) {
    // Already editing: right-click opens this card's editor directly
    openEditModal(props.index)
    return
  }
  fireEditMode()
}

// ---- Drag & Drop (HTML5, desktop) ----
function handleDragStart(e) {
  e.dataTransfer.setData('text/plain', String(props.index))
  e.dataTransfer.effectAllowed = 'move'
  e.target.classList.add('dragging')
  window.dispatchEvent(new CustomEvent('reorder-drag-start', { detail: { index: props.index } }))
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging')
  document.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'))
  window.dispatchEvent(new CustomEvent('reorder-drag-end'))
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

// ---- Touch: long-press → edit mode (mobile) / long-press drag (edit mode) ----
let touchDrag = null
let pressTimer = null
let pressStart = null

function cancelPress() {
  clearTimeout(pressTimer)
  pressTimer = null
}

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
      window.dispatchEvent(new CustomEvent('touch-reorder-start'))
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
  e.stopPropagation()
  const t = e.touches[0]
  const target = document.elementFromPoint(t.clientX, t.clientY)?.closest('.card')
  document.querySelectorAll('.card.touch-over').forEach(c => c.classList.remove('touch-over'))
  if (target && target !== touchDrag.el) {
    target.classList.add('touch-over')
    touchDrag.over = target
  } else {
    touchDrag.over = null
  }
  window.dispatchEvent(new CustomEvent('touch-reorder-move', {
    detail: { x: t.clientX, y: t.clientY },
  }))
}

function handleTouchEnd(e) {
  clearTimeout(pressTimer)
  pressStart = null
  if (touchDrag) {
    e.stopPropagation()
    touchDrag.el.classList.remove('touch-dragging')
    const over = touchDrag.over
    if (over) over.classList.remove('touch-over')
    const t = e.changedTouches?.[0]
    window.dispatchEvent(new CustomEvent('touch-reorder-drop', {
      detail: {
        srcIndex: props.index,
        targetIndex: over ? Number(over.dataset.index) : null,
        x: t?.clientX,
        y: t?.clientY,
      },
    }))
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
    @contextmenu.prevent="handleContextMenu"
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
    <div class="icon-wrap">
      <div class="card-icon" :class="{ 'icon-text-mode': isTextIcon }" :style="{ '--h': hue }">
        <img
          v-if="service.iconType === 'url' && service.icon && !iconFailed"
          :src="service.icon"
          :alt="service.name"
          referrerpolicy="no-referrer"
          @error="iconFailed = true"
        >
        <span v-if="isTextIcon" class="card-icon-text">{{ textChar }}</span>
      </div>

      <!-- Edit-mode overlay: delete top-right, edit center (anchored to the icon) -->
      <template v-if="editMode">
        <button class="edit-badge edit-x" type="button" title="删除" @click.stop="handleDelete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round">
            <line x1="7" y1="7" x2="17" y2="17"/>
            <line x1="17" y1="7" x2="7" y2="17"/>
          </svg>
        </button>
        <button class="edit-badge edit-pencil" type="button" title="编辑" @click.stop="handleEdit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
        </button>
      </template>
    </div>
    <div class="card-meta">
      <div class="card-name">{{ service.name }}</div>
      <div class="card-host">{{ host }}</div>
    </div>

    <!-- Edit-mode overlay moved inside .icon-wrap (anchored to the icon) -->
  </div>
</template>
