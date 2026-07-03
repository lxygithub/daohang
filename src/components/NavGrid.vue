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

function openUrl(url) {
  window.open(url, '_blank')
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
})

onUnmounted(() => {
  window.removeEventListener('drop-reorder', handleDropReorder)
  window.removeEventListener('delete-service', handleDeleteService)
})
</script>

<template>
  <div class="card-grid">
    <NavCard
      v-for="svc in filteredServices"
      :key="svc.id"
      :service="svc"
      :index="svc._index"
      @open="openUrl(svc.url)"
    />
  </div>
</template>
