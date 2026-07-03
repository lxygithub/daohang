<script setup>
import { inject } from 'vue'
import { ICONS } from '../data/icons'

const props = defineProps({
  service: { type: Object, required: true },
  index: { type: Number, required: true },
})

const emit = defineEmits(['open'])
const openEditModal = inject('openEditModal')

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
</script>

<template>
  <div
    class="card"
    :style="{ animationDelay: `${index * 0.04}s` }"
    draggable="true"
    @click="handleClick"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @dragover="handleDragOver"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div class="card-icon">
      <img
        v-if="service.iconType === 'url' && service.icon"
        :src="service.icon"
        :alt="service.name"
      >
      <span v-else v-html="ICONS[service.icon] || ICONS.server"></span>
    </div>
    <div class="card-name" :title="service.url">{{ service.name }}</div>
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
