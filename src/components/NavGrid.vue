<script setup>
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import NavCard from './NavCard.vue'

const props = defineProps({
  services: { type: Array, required: true },
  filter: { type: String, default: '' },
})

const emit = defineEmits(['reordered'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')

// ---- persisted local prefs ----
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const collapsed = ref(loadJSON('nav_collapsed', {}))
const clicks = ref(loadJSON('nav_clicks', {}))
const SORT_KEY = 'nav_sort_usage'
const sortUsage = ref(localStorage.getItem(SORT_KEY) === '1')
const LAYOUT_KEY = 'nav_layout'
const layout = ref(localStorage.getItem(LAYOUT_KEY) || 'card')

function saveCollapsed() {
  try { localStorage.setItem('nav_collapsed', JSON.stringify(collapsed.value)) } catch {}
}

function toggleGroup(name) {
  collapsed.value = { ...collapsed.value, [name]: !collapsed.value[name] }
  saveCollapsed()
}

// ---- data pipeline ----
const indexed = computed(() => props.services.map((s, i) => ({ ...s, _index: i })))

const filteredServices = computed(() => {
  if (!props.filter) return indexed.value
  const q = props.filter.toLowerCase()
  return indexed.value.filter(s =>
    s.name.toLowerCase().includes(q) || (s.group || '').toLowerCase().includes(q)
  )
})

// Usage-based sorting (manual order kept when disabled)
const sortedServices = computed(() => {
  if (!sortUsage.value) return indexed.value
  return [...indexed.value].sort((a, b) =>
    (clicks.value[b.id] || 0) - (clicks.value[a.id] || 0)
  )
})

const hasGroups = computed(() => indexed.value.some(s => (s.group || '').trim()))

const groupSections = computed(() => {
  if (!hasGroups.value) return [{ name: '', items: sortedServices.value }]
  const order = []
  const map = new Map()
  for (const s of sortedServices.value) {
    const g = (s.group || '').trim() || '未分组'
    if (!map.has(g)) { map.set(g, []); order.push(g) }
    map.get(g).push(s)
  }
  return order.map(name => ({ name, items: map.get(name) }))
})

// Flat list currently displayed (search mode or ungrouped)
const visibleFlat = computed(() =>
  props.filter ? filteredServices.value : sortedServices.value
)

const showEmptyHint = computed(() =>
  props.filter && filteredServices.value.length === 0
)

// ---- actions ----
function recordClick(id) {
  clicks.value = { ...clicks.value, [id]: (clicks.value[id] || 0) + 1 }
  try { localStorage.setItem('nav_clicks', JSON.stringify(clicks.value)) } catch {}
}

function openService(svc) {
  recordClick(svc.id)
  window.open(svc.url, '_blank')
}

// 回车直达：打开第一个可见项
function handleOpenFirstMatch() {
  const first = props.filter
    ? filteredServices.value[0]
    : groupSections.value[0]?.items[0]
  if (first) openService(first)
}

function handleUsageSortChanged(e) {
  sortUsage.value = !!e.detail
}

function handleLayoutChanged(e) {
  layout.value = e.detail === 'list' ? 'list' : 'card'
}

function handleDropReorder(e) {
  const { srcIndex, targetIndex } = e.detail
  ensureVerified(() => {
    const targetSvc = props.services[targetIndex]
    const [item] = props.services.splice(srcIndex, 1)
    props.services.splice(targetIndex, 0, item)
    // 跨组拖拽时跟随目标分组
    if (hasGroups.value && targetSvc && (item.group || '') !== (targetSvc.group || '')) {
      item.group = targetSvc.group
      const g = (targetSvc.group || '').trim()
      showToast(g ? `已移动到「${g}」` : '已移动到未分组')
    }
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
  window.addEventListener('usage-sort-changed', handleUsageSortChanged)
  window.addEventListener('layout-changed', handleLayoutChanged)
})

onUnmounted(() => {
  window.removeEventListener('drop-reorder', handleDropReorder)
  window.removeEventListener('delete-service', handleDeleteService)
  window.removeEventListener('open-first-match', handleOpenFirstMatch)
  window.removeEventListener('usage-sort-changed', handleUsageSortChanged)
  window.removeEventListener('layout-changed', handleLayoutChanged)
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

  <!-- 搜索模式 / 未分组：平铺网格 -->
  <div v-else-if="props.filter || !hasGroups" class="card-grid" :class="{ 'layout-list': layout === 'list' }">
    <NavCard
      v-for="svc in visibleFlat"
      :key="svc.id"
      :service="svc"
      :index="svc._index"
      @open="openService(svc)"
    />
  </div>

  <!-- 分组模式 -->
  <template v-else>
    <section v-for="sec in groupSections" :key="sec.name" class="group-section">
      <button class="group-header" type="button" @click="toggleGroup(sec.name)">
        <svg class="group-chevron" :class="{ collapsed: !!collapsed[sec.name] }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span class="group-name">{{ sec.name || '未分组' }}</span>
        <span class="group-count">{{ sec.items.length }}</span>
      </button>
      <div v-show="!collapsed[sec.name]" class="card-grid" :class="{ 'layout-list': layout === 'list' }">
        <NavCard
          v-for="svc in sec.items"
          :key="svc.id"
          :service="svc"
          :index="svc._index"
          @open="openService(svc)"
        />
      </div>
    </section>
  </template>
</template>
