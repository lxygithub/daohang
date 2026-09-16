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

// 鼠标拖动空白处翻页（桌面端）
// 起点 .card 上不接管——卡片自带 HTML5 拖拽排序；圆点等 button 也跳过
const dragDx = ref(0)      // 拖动进行中的横向位移（px，跟手预览）
const dragging = ref(false)
const pagerWrap = ref(null)
let mdrag = null

function handlePagerMouseDown(e) {
  if (e.button !== 0 || pages.value.length < 2) return
  if (e.target.closest?.('.card') || e.target.closest?.('button')) return
  mdrag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
  dragging.value = true
  document.body.style.cursor = 'grabbing'
  window.addEventListener('mousemove', handlePagerMouseMove)
  window.addEventListener('mouseup', handlePagerMouseUp)
}

function handlePagerMouseMove(e) {
  if (!mdrag) return
  mdrag.dx = e.clientX - mdrag.x
  mdrag.dy = e.clientY - mdrag.y
  const { dx, dy } = mdrag
  if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 4) return
  // 拖到边界继续拖给一点阻力（橡皮筋感）
  const atEdge =
    (dx < 0 && page.value >= pages.value.length - 1) ||
    (dx > 0 && page.value <= 0)
  dragDx.value = atEdge ? Math.round(dx * 0.28) : dx
}

function handlePagerMouseUp() {
  window.removeEventListener('mousemove', handlePagerMouseMove)
  window.removeEventListener('mouseup', handlePagerMouseUp)
  document.body.style.cursor = ''
  if (!mdrag) return
  const { dx, dy } = mdrag
  mdrag = null
  dragging.value = false
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48) {
    if (dx < 0) nextPage()
    else prevPage()
  }
  dragDx.value = 0
}

// 窗口失焦时丢弃未完成的拖拽，避免 mouseup 丢失导致状态卡死
function handlePagerDragAbort() {
  if (!mdrag) return
  window.removeEventListener('mousemove', handlePagerMouseMove)
  window.removeEventListener('mouseup', handlePagerMouseUp)
  document.body.style.cursor = ''
  mdrag = null
  dragging.value = false
  dragDx.value = 0
  clearFlipArm()
}

// 滚轮 / 触控板翻页：横向位移优先，翻页后短暂锁定防惯性连翻；
// 已在边缘时不拦截，保留页面默认滚动
let wheelLockUntil = 0
function handlePagerWheel(e) {
  if (pages.value.length < 2) return
  let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (e.deltaMode === 1) d *= 40
  else if (e.deltaMode === 2) d *= window.innerHeight || 800
  if (Math.abs(d) < 8) return
  const now = performance.now()
  if (now < wheelLockUntil) { e.preventDefault(); return }
  const canNext = d > 0 && page.value < pages.value.length - 1
  const canPrev = d < 0 && page.value > 0
  if (!canNext && !canPrev) return
  e.preventDefault()
  wheelLockUntil = now + 550
  if (canNext) nextPage()
  else prevPage()
}

// ---- 拖拽排序时拖到左右边缘自动翻页 ----
// HTML5 拖拽悬停在屏幕外的页上不会触发 dragover（被 overflow:hidden 裁掉），
// 所以必须靠边缘侦测主动翻页，否则图标永远拖不到下一页。
const EDGE_ZONE = 112    // 距边缘多少 px 内触发
const FLIP_DELAY = 360   // 悬停多久翻页（ms）
const flipHint = ref('') // '' | 'prev' | 'next' —— 只作视觉提示
let flipTimer = null
let flipDir = ''
let activeReorderDrag = null

function clearFlipArm() {
  clearTimeout(flipTimer)
  flipTimer = null
  flipDir = ''
  flipHint.value = ''
}

function armFlip(dir) {
  if (flipDir === dir) return
  clearFlipArm()
  flipDir = dir
  flipHint.value = dir
  flipTimer = setTimeout(() => {
    flipTimer = null
    flipDir = ''
    flipHint.value = ''
    if (dir === 'next') nextPage()
    else prevPage()
  }, FLIP_DELAY)
}

function handlePagerDragOver(e) {
  // 始终 preventDefault：空白处也要能落点，否则只有卡片是合法投放目标
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  handlePagerDragAt(e.clientX, e.clientY)
}

function handlePagerDragAt(clientX, clientY) {
  if (pages.value.length < 2) return
  const r = pagerWrap.value?.getBoundingClientRect()
  if (!r || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
    clearFlipArm()
    return
  }
  const last = pages.value.length - 1
  if (clientX - r.left < EDGE_ZONE && page.value > 0) armFlip('prev')
  else if (r.right - clientX < EDGE_ZONE && page.value < last) armFlip('next')
  else clearFlipArm()
}

// 不把自动翻页绑死在 .pager-wrap：浏览器原生拖拽经过卡片、空白区
// 或 overflow 裁剪边缘时，目标元素收到 dragover 的方式并不一致。
// 只要本次拖拽由导航卡片发起，就从 window 收集坐标，翻页不会丢失。
function handleReorderDragStart(e) {
  const index = e.detail?.index
  activeReorderDrag = Number.isInteger(index) ? index : null
}

function handleReorderDragOver(e) {
  if (activeReorderDrag === null) return
  handlePagerDragAt(e.clientX, e.clientY)
}

function handleReorderDragEnd() {
  activeReorderDrag = null
  clearFlipArm()
}

function handlePagerDragLeave(e) {
  // dragleave 会从子元素冒泡上来，真正离开 .pager-wrap 才清计时
  const r = e.currentTarget.getBoundingClientRect()
  const inside =
    e.clientX >= r.left && e.clientX <= r.right &&
    e.clientY >= r.top && e.clientY <= r.bottom
  if (inside) return
  clearFlipArm()
}

// 落在页面空白处：插到该页首个图标之前（页内空位不再是死区）
function handlePagerDrop(e) {
  clearFlipArm()
  if (e.target.closest?.('.card')) return   // 落在卡片上：交给 NavCard 处理（drop 冒泡到此）
  const raw = e.dataTransfer.getData('text/plain')
  if (!/^\d+$/.test(raw)) return          // 外部拖入的文本/文件不是本次排序
  reorderOnPagerBlank(Number(raw), e.target.closest?.('.pager-page'))
}

function reorderOnPagerBlank(srcIndex, pageEl) {
  const pi = Number(pageEl?.dataset.page)
  if (!Number.isInteger(pi)) return
  const pg = pages.value[pi]
  if (!pg) return
  // 空白页没有卡片可作为 drop target，末页则直接追加到列表尾。
  const targetIndex = pg.length ? pg[0]._index : props.services.length
  if (srcIndex === targetIndex) return
  window.dispatchEvent(new CustomEvent('drop-reorder', { detail: { srcIndex, targetIndex } }))
}

// 手机端使用自定义长按拖动，原先只会命中当前页的卡片。
// NavCard 把手指坐标交给此处，复用桌面端的边缘翻页，并支持投放到新页空白处。
function handleTouchReorderMove(e) {
  const { x, y } = e.detail || {}
  if (Number.isFinite(x) && Number.isFinite(y)) handlePagerDragAt(x, y)
}

function handleTouchReorderStart() {
  // 长按拖拽不能在松手时又被当成普通侧滑。
  swipe = null
}

function handleTouchReorderDrop(e) {
  clearFlipArm()
  const { srcIndex, targetIndex: savedTargetIndex, x, y } = e.detail || {}
  if (!Number.isInteger(srcIndex)) return
  const target = Number.isFinite(x) && Number.isFinite(y)
    ? document.elementFromPoint(x, y)
    : null
  const card = target?.closest?.('.card')
  if (card) {
    const targetIndex = Number(card.dataset.index)
    if (Number.isInteger(targetIndex) && targetIndex !== srcIndex) {
      window.dispatchEvent(new CustomEvent('drop-reorder', { detail: { srcIndex, targetIndex } }))
    }
    return
  }
  if (Number.isInteger(savedTargetIndex) && savedTargetIndex !== srcIndex) {
    window.dispatchEvent(new CustomEvent('drop-reorder', { detail: { srcIndex, targetIndex: savedTargetIndex } }))
    return
  }
  reorderOnPagerBlank(srcIndex, target?.closest?.('.pager-page'))
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
  window.addEventListener('blur', handlePagerDragAbort)
  window.addEventListener('dragover', handleReorderDragOver)
  window.addEventListener('reorder-drag-start', handleReorderDragStart)
  window.addEventListener('reorder-drag-end', handleReorderDragEnd)
  window.addEventListener('drop-reorder', handleDropReorder)
  window.addEventListener('touch-reorder-start', handleTouchReorderStart)
  window.addEventListener('touch-reorder-move', handleTouchReorderMove)
  window.addEventListener('touch-reorder-drop', handleTouchReorderDrop)
  window.addEventListener('delete-service', handleDeleteService)
  window.addEventListener('open-first-match', handleOpenFirstMatch)
  window.addEventListener('usage-sort-changed', handleUsageSortChanged)
  window.addEventListener('layout-changed', handleLayoutChanged)
  window.addEventListener('view-changed', handleViewChanged)
  window.addEventListener('grid-changed', handleGridChanged)
})

onUnmounted(() => {
  window.removeEventListener('blur', handlePagerDragAbort)
  window.removeEventListener('dragover', handleReorderDragOver)
  window.removeEventListener('reorder-drag-start', handleReorderDragStart)
  window.removeEventListener('reorder-drag-end', handleReorderDragEnd)
  window.removeEventListener('drop-reorder', handleDropReorder)
  window.removeEventListener('touch-reorder-start', handleTouchReorderStart)
  window.removeEventListener('touch-reorder-move', handleTouchReorderMove)
  window.removeEventListener('touch-reorder-drop', handleTouchReorderDrop)
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
  <div
    v-else-if="pagerOn"
    ref="pagerWrap"
    class="pager-wrap"
    :style="gridVars"
    @mousedown="handlePagerMouseDown"
    @wheel="handlePagerWheel"
    @dragover="handlePagerDragOver"
    @dragleave="handlePagerDragLeave"
    @drop="handlePagerDrop"
    @dragend="clearFlipArm"
  >
    <div
      class="pager"
      @touchstart="handlePagerTouchStart"
      @touchmove="handlePagerTouchMove"
      @touchend="handlePagerTouchEnd"
      @touchcancel="handlePagerTouchEnd"
    >
      <!-- 拖拽到边缘时的翻页提示 -->
      <div v-if="flipHint" class="pager-flip" :class="flipHint" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline :points="flipHint === 'next' ? '9 6 15 12 9 18' : '15 6 9 12 15 18'"/>
        </svg>
      </div>
      <div class="pager-track" :class="{ 'no-anim': dragging }" :style="{ transform: `translateX(calc(-${page * 100}% + ${dragDx}px))` }">
        <div v-for="(pg, pi) in pages" :key="pi" class="pager-page card-grid layout-phone" :data-page="pi">
          <NavCard
            v-for="svc in pg"
            :key="svc.id"
            :service="svc"
            :index="svc._index"
            @open="openService(svc)"
          />
        </div>
      </div>
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
    <!-- 字母视图：按字母分组多列铺开，列数随图标数量自适应 -->
    <div v-if="useAlpha" class="alpha-wrap" :style="gridVars">
      <section v-for="sec in sections" :key="sec.name" class="alpha-section">
        <button class="group-header alpha-header" type="button" @click="toggleGroup(sec.name)">
          <svg class="group-chevron" :class="{ collapsed: !!collapsed[sec.name] }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <span class="group-name alpha-letter">{{ sec.name }}</span>
          <span class="group-count">{{ sec.items.length }}</span>
        </button>
        <div v-show="!collapsed[sec.name]" class="card-grid layout-phone alpha-grid">
          <NavCard
            v-for="svc in sec.items"
            :key="svc.id"
            :service="svc"
            :index="svc._index"
            @open="openService(svc)"
          />
        </div>
      </section>
    </div>

    <!-- 普通分组视图 -->
    <template v-else>
      <section v-for="sec in sections" :key="sec.name" class="group-section">
        <button class="group-header" type="button" @click="toggleGroup(sec.name)">
          <svg class="group-chevron" :class="{ collapsed: !!collapsed[sec.name] }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <span class="group-name">{{ sec.name || '未分组' }}</span>
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
</template>
