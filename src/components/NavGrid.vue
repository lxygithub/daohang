<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import NavCard from './NavCard.vue'
import { loadLayout, saveLayout, loadView, loadGrid, defaultGrid } from '../composables/usePrefs'

const props = defineProps({
  services: { type: Array, required: true },
  filter: { type: String, default: '' },
  view: { type: String, default: 'grid' }, // 'grid' | 'alpha'
})

const emit = defineEmits(['reordered'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')
const configRef = inject('config')

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
const layout = ref(loadLayout())
const viewMode = ref(props.view || loadView())
const grid = ref(loadGrid())

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

// ---- Alphabetical grouping (A-Z, pinyin initials for Chinese, # fallback) ----
const PY_BOUNDS = [
  ['A', '啊'], ['B', '芭'], ['C', '擦'], ['D', '搭'], ['E', '蛾'], ['F', '发'],
  ['G', '噶'], ['H', '哈'], ['J', '击'], ['K', '喀'], ['L', '垃'], ['M', '妈'],
  ['N', '拿'], ['O', '哦'], ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'],
  ['T', '塌'], ['W', '挖'], ['X', '昔'], ['Y', '压'], ['Z', '匝'],
]

function alphaOf(name) {
  const c = (name || '?').charAt(0)
  if (/[a-z]/i.test(c)) return c.toUpperCase()
  if (/[0-9]/.test(c)) return '#'
  let letter = '#'
  for (const [L, bound] of PY_BOUNDS) {
    try {
      if (c.localeCompare(bound, 'zh-Hans-CN-u-co-pinyin') >= 0) letter = L
    } catch { break }
  }
  return letter
}

const alphaSections = computed(() => {
  const map = new Map()
  for (const s of sortedServices.value) {
    const L = alphaOf(s.name)
    if (!map.has(L)) map.set(L, [])
    map.get(L).push(s)
  }
  const letters = [...map.keys()].sort((a, b) => {
    if (a === '#') return 1
    if (b === '#') return -1
    return a.localeCompare(b)
  })
  return letters.map(L => ({ name: L, items: map.get(L), alpha: true }))
})

const useAlpha = computed(() => viewMode.value === 'alpha' && !props.filter)
const sections = computed(() => (useAlpha.value ? alphaSections.value : groupSections.value))

// Flat list currently displayed (search mode or ungrouped)
const visibleFlat = computed(() =>
  props.filter ? filteredServices.value : sortedServices.value
)

const showEmptyHint = computed(() =>
  props.filter && filteredServices.value.length === 0
)

// ---- Phone-style pager (home-screen like pages) ----
const pagerOn = computed(() =>
  layout.value === 'phone' && viewMode.value === 'grid' && !props.filter && !hasGroups.value
)

const page = ref(0)
const pages = computed(() => {
  if (!pagerOn.value) return []
  const cap = Math.max(1, grid.value.rows * grid.value.cols)
  const arr = visibleFlat.value
  const out = []
  for (let i = 0; i < arr.length; i += cap) out.push(arr.slice(i, i + cap))
  return out.length ? out : [[]]
})

watch(() => props.filter, () => { page.value = 0 })
watch(() => pages.value.length, (n) => {
  if (page.value > n - 1) page.value = Math.max(0, n - 1)
})

const gridVars = computed(() => ({
  '--cols': String(grid.value.cols),
  '--rows': String(grid.value.rows),
  '--icon-size': grid.value.size + 'px',
}))

function nextPage() { if (page.value < pages.value.length - 1) page.value++ }
function prevPage() { if (page.value > 0) page.value-- }

// Swipe between pages
let swipe = null
function handlePagerTouchStart(e) {
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY }
}
function handlePagerTouchMove(e) {
  if (!swipe) return
  const dx = e.touches[0].clientX - swipe.x
  const dy = e.touches[0].clientY - swipe.y
  // Horizontal swipe on the pager should not scroll the page
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) e.preventDefault()
}
function handlePagerTouchEnd(e) {
  if (!swipe) return
  const dx = e.changedTouches[0].clientX - swipe.x
  const dy = e.changedTouches[0].clientY - swipe.y
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48) {
    if (dx < 0) nextPage()
    else prevPage()
  }
  swipe = null
}

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
  layout.value = e.detail === 'list' ? 'list' : (e.detail === 'phone' ? 'phone' : 'card')
  page.value = 0
}

function handleViewChanged(e) {
  viewMode.value = e.detail === 'alpha' ? 'alpha' : 'grid'
}

function handleGridChanged(e) {
  const d = e.detail || {}
  const def = defaultGrid()
  grid.value = {
    rows: d.rows || def.rows,
    cols: d.cols || def.cols,
    size: d.size || def.size,
  }
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
  if (!confirm(`确定删除「${name}」？可在设置中恢复`)) return
  ensureVerified(() => {
    const [item] = props.services.splice(index, 1)
    // 移入回收站（保留最近 30 条）
    if (item && configRef?.value) {
      const cfg = configRef.value
      cfg.trash = [item, ...(cfg.trash || [])].slice(0, 30)
    }
    emit('reordered')
    showToast('已移入回收站')
  })
}

onMounted(() => {
  window.addEventListener('drop-reorder', handleDropReorder)
  window.addEventListener('delete-service', handleDeleteService)
  window.addEventListener('open-first-match', handleOpenFirstMatch)
  window.addEventListener('usage-sort-changed', handleUsageSortChanged)
  window.addEventListener('layout-changed', handleLayoutChanged)
  window.addEventListener('view-changed', handleViewChanged)
  window.addEventListener('grid-changed', handleGridChanged)
})

onUnmounted(() => {
  window.removeEventListener('drop-reorder', handleDropReorder)
  window.removeEventListener('delete-service', handleDeleteService)
  window.removeEventListener('open-first-match', handleOpenFirstMatch)
  window.removeEventListener('usage-sort-changed', handleUsageSortChanged)
  window.removeEventListener('layout-changed', handleLayoutChanged)
  window.removeEventListener('view-changed', handleViewChanged)
  window.removeEventListener('grid-changed', handleGridChanged)
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

  <!-- 手机屏幕式分页（phone 布局 + 网格视图 + 未搜索 + 无分组） -->
  <div v-else-if="pagerOn" class="pager-wrap" :style="gridVars">
    <div
      class="pager"
      @touchstart="handlePagerTouchStart"
      @touchmove="handlePagerTouchMove"
      @touchend="handlePagerTouchEnd"
      @touchcancel="handlePagerTouchEnd"
    >
      <div class="pager-track" :style="{ transform: `translateX(-${page * 100}%)` }">
        <div v-for="(pg, pi) in pages" :key="pi" class="pager-page card-grid layout-phone">
          <NavCard
            v-for="svc in pg"
            :key="svc.id"
            :service="svc"
            :index="svc._index"
            @open="openService(svc)"
          />
        </div>
      </div>
      <button v-if="page > 0" class="pager-arrow prev" type="button" title="上一页" @click="prevPage">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button v-if="page < pages.length - 1" class="pager-arrow next" type="button" title="下一页" @click="nextPage">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div v-if="pages.length > 1" class="pager-dots">
      <template v-if="pages.length <= 9">
        <button
          v-for="(_, di) in pages"
          :key="di"
          type="button"
          class="pager-dot"
          :class="{ on: di === page }"
          :title="`第 ${di + 1} 页`"
          @click="page = di"
        ></button>
      </template>
      <span v-else class="pager-count">{{ page + 1 }} / {{ pages.length }}</span>
    </div>
  </div>

  <!-- 搜索模式 / 未分组：平铺网格（字母视图除外，字母视图始终带字母分组头） -->
  <div v-else-if="(props.filter || !hasGroups) && !useAlpha" class="card-grid" :class="{ 'layout-list': layout === 'list', 'layout-phone': layout === 'phone' }" :style="layout === 'phone' ? gridVars : null">
    <NavCard
      v-for="svc in visibleFlat"
      :key="svc.id"
      :service="svc"
      :index="svc._index"
      @open="openService(svc)"
    />
  </div>

  <!-- 分组模式 / 字母视图 -->
  <template v-else>
    <section v-for="sec in sections" :key="sec.name" class="group-section" :class="{ 'alpha-section': !!sec.alpha }">
      <button class="group-header" type="button" @click="toggleGroup(sec.name)">
        <svg class="group-chevron" :class="{ collapsed: !!collapsed[sec.name] }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span class="group-name" :class="{ 'alpha-letter': !!sec.alpha }">{{ sec.name || '未分组' }}</span>
        <span class="group-count">{{ sec.items.length }}</span>
      </button>
      <div v-show="!collapsed[sec.name]" class="card-grid" :class="{ 'layout-list': layout === 'list', 'layout-phone': layout === 'phone' }" :style="layout === 'phone' ? gridVars : null">
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
