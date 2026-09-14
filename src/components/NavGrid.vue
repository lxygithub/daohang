<script setup>
import { computed, inject, onMounted, onUnmounted } from 'vue'
import NavCard from './NavCard.vue'

const props = defineProps({
  services: { type: Array, required: true },
  filter: { type: String, default: '',
},
})

const emit = defineEmits(['reordered'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')

const filteredServices = computed(() => {
  if (!props.filter) return props.services.map((s, i) => ({ ...s, _index: i }))
  const q = props.filter.toLowerCase()
  return props.services
    .map((s, i) => ({ ...s, _index: i }))
    .filter(s => s.name.toLowerCase().includes(q))
})

const showEmptyHint = computed(() =>
  props.filter && filteredServices.value.length === 0
)

function openUrl(url) {
  window.open(url, '_blank')
}

// 回车直达：打开第一个匹配项
function handleOpenFirstMatch() {
  const first = filteredServices.value[0]
  if (first) openUrl(first.url)
}

// 访问统计（本地存储，按服务 id 计数）
function recordClick(id) {
  try {
    const raw = localStorage.getItem('nav_clicks')
    const clicks = raw ? JSON.parse(raw) : {}
    clicks[id] = (clicks[id] || 0) + 1
    localStorage.setItem('nav_clicks', JSON.stringify(clicks))
  } catch {}
}

function openService(svc) {
  recordClick(svc.id)
  openUrl(svc.url)
}

function handleDropReorder(e) {
  const { srcIndex, targetIndex } = e.detail
  ensureVerified(() => {
    const [item] = props.services.splice(srcIndex, 1)
    props.services.splice(targetIndex, 0, item)
    emit('reordered')
  })
}

function handleDeleteService(e) {
  const { index } = e.detail
  const name = props.services[index].name
  if (!confirm(`确定删除「${name}」？`)) return
  ensureVerified(() => {
    props.services.splice(index, 1)
    emit('reordered')
    showToast('已删除')
  })
}

onMounted(() => {
  window.addEventListener('drop-reorder', handleDropReorder)
  window.addEventListener('delete-service', handleDeleteService)
  window.addEventListener('open-first-match', handleOpenFirstMatch)
})

onUnmounted(() => {
  window.removeEventListener('drop-reorder', handleDropReorder)
  window.removeEventListener('delete-service', handleDeleteService)
  window.removeEventListener('open-first-match', handleOpenFirstMatch)
})
</script>

<template>
  <div v-if="showEmptyHint" class="empty-hint">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <div>没有找到匹配「{{ props.filter }}」的服务</div>
  </div>
  <div v-else class="card-grid">
    <NavCard
      v-for="svc in filteredServices"
      :key="svc.id"
      :service="svc"
      :index="svc._index"
      @open="openService(svc)"
    />
  </div>
</template>
