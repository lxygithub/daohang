<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { textIconChars } from '../utils/textIcon'

// 全屏「搜索图标」弹窗（Ctrl+F 唤起，参照 inftab 同名功能并修正其缺点）：
// 1. 结果网格顶部对齐（align-content: start），末页不满时不留大片空白
// 2. 翻页：滚轮 / 空白处按住拖动，不显示左右切换箭头
// 3. 独立全屏弹层，不与顶部搜索栏混用
const props = defineProps({
  visible: Boolean,
  services: { type: Array, required: true },
})
const emit = defineEmits(['close'])

const q = ref('')
const page = ref(0)
const inputRef = ref(null)
const stageEl = ref(null)

// ---- 过滤：名称 / 网址 / 分组 ----
const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  const list = props.services || []
  if (!kw) return list
  return list.filter(s =>
    (s.name || '').toLowerCase().includes(kw) ||
    (s.url || '').toLowerCase().includes(kw) ||
    (s.group || '').toLowerCase().includes(kw)
  )
})

// ---- 容量测量：每页 = 实测列数 × 行数（不足一行按一行），结果永远顶部对齐 ----
const cols = ref(4)
const rows = ref(3)
let ro = null
function measure() {
  const el = stageEl.value
  if (!el) return
  const w = el.clientWidth
  const h = el.clientHeight
  // 单元格按 112×136 预估（偏保守：宁少勿溢出）
  cols.value = Math.max(2, Math.floor(w / 112))
  rows.value = Math.max(1, Math.floor(h / 136))
}
const capacity = computed(() => Math.max(1, cols.value * rows.value))

const pages = computed(() => {
  const arr = filtered.value
  const out = []
  for (let i = 0; i < arr.length; i += capacity.value) out.push(arr.slice(i, i + capacity.value))
  return out.length ? out : [[]]
})
const pageItems = computed(() => pages.value[page.value] || [])

watch(() => props.visible, async (v) => {
  if (!v) return
  q.value = ''
  page.value = 0
  await nextTick()
  measure()
  inputRef.value?.focus()
})
watch(q, () => { page.value = 0 })
watch(pages, (p) => { if (page.value > p.length - 1) page.value = Math.max(0, p.length - 1) })

onMounted(() => {
  ro = new ResizeObserver(() => { if (props.visible) measure() })
  if (stageEl.value) ro.observe(stageEl.value)
})
onUnmounted(() => ro?.disconnect())

// ---- 翻页动作（无箭头按钮，仅滚轮 / 拖拽 / 键盘）----
function nextPage() { if (page.value < pages.value.length - 1) page.value++ }
function prevPage() { if (page.value > 0) page.value-- }

// 滚轮翻页：累计增量过阈值翻一页，带最小间隔防触控板连发刷屏
let wheelLock = 0
let wheelAcc = 0
function onWheel(e) {
  e.preventDefault()
  const now = Date.now()
  if (now - wheelLock < 240) return
  wheelAcc += e.deltaY
  if (wheelAcc > 60) { nextPage(); wheelLock = now; wheelAcc = 0 }
  else if (wheelAcc < -60) { prevPage(); wheelLock = now; wheelAcc = 0 }
}

// 空白处拖动翻页（鼠标按住左右甩 / 触屏侧滑）；
// 原地点击（几乎无位移）视为关闭弹窗
let drag = null
function onPointerDown(e) {
  if (e.button !== 0 && e.pointerType === 'mouse') return
  if (e.target.closest('input, button, a, .sm-card')) return
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId }
}
function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.id) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  drag = null
  if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) nextPage()
    else prevPage()
  } else if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
    emit('close')
  }
}
// 拖动中禁止选中文本
function onPointerMove(e) {
  if (drag && e.pointerId === drag.id && Math.abs(e.clientX - drag.x) > 4) {
    e.preventDefault?.()
  }
}

// ---- 打开站点 ----
function open(svc) {
  if (!svc?.url) return
  window.open(svc.url, '_blank')
  emit('close')
}
function openFirst() {
  if (pageItems.value.length) open(pageItems.value[0])
}

// ---- 文字图标着色（与 NavCard 同款确定性色相）----
function hue(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360
  return (h * 7) % 360
}
function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u }
}

// 暴露给 App 的全局键：组件可见时自行监听方向键翻页（Esc 由 App 统一关弹层）
function onGlobalKey(e) {
  if (!props.visible) return
  const tag = document.activeElement?.tagName
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA'
  if (e.key === 'ArrowRight' && !inInput) { e.preventDefault(); nextPage() }
  else if (e.key === 'ArrowLeft' && !inInput) { e.preventDefault(); prevPage() }
}
window.addEventListener('keydown', onGlobalKey)
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))
</script>

<template>
  <div
    class="sm-overlay"
    :class="{ active: visible }"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointermove="onPointerMove"
  >
    <button class="sm-close" title="关闭" @click="emit('close')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>

    <div class="sm-wrap">
      <div class="sm-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/>
        </svg>
        <input
          ref="inputRef"
          v-model="q"
          type="text"
          placeholder="搜索已添加的站点（名称 / 网址 / 分组）"
          @keydown.enter.prevent="openFirst"
        >
      </div>
      <div class="sm-subline" v-if="services.length">
        {{ q ? `匹配 ${filtered.length} 个站点` : `共 ${services.length} 个站点` }}
        <span class="sm-kbd">Enter 打开首个 · 滚轮 / 拖动空白翻页</span>
      </div>

      <div class="sm-stage" ref="stageEl">
        <div v-if="!services.length" class="sm-empty">还没有添加站点，先去「新增服务」或「内置导航」里添加吧</div>
        <div v-else-if="!filtered.length" class="sm-empty">未找到与「{{ q.trim() }}」匹配的站点</div>
        <transition name="sm-flip" mode="out-in">
          <div class="sm-grid" :key="page" v-if="services.length && filtered.length">
            <button
              v-for="(s, i) in pageItems"
              :key="s.id || s.url"
              class="sm-card"
              :title="s.url"
              :style="{ animationDelay: `${Math.min(i * 0.025, 0.4)}s` }"
              @click="open(s)"
            >
              <span class="sm-icon" :style="(!(s.iconType === 'url' && s.icon)) ? { background: `hsl(${hue(s.name)} 45% 45%)` } : {}">
                <img
                  v-if="s.iconType === 'url' && s.icon"
                  :src="s.icon" :alt="s.name" loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="$event.target.style.display = 'none'"
                >
                <span v-else class="sm-icon-text">{{ textIconChars(s.name) }}</span>
              </span>
              <span class="sm-name">{{ s.name }}</span>
              <span class="sm-host">{{ host(s.url) }}</span>
            </button>
          </div>
        </transition>
      </div>

      <div class="sm-dots" v-if="pages.length > 1">
        <template v-if="pages.length <= 12">
          <span
            v-for="n in pages.length" :key="n"
            class="sm-dot" :class="{ on: n - 1 === page }"
          ></span>
        </template>
        <span v-else class="sm-page-no">{{ page + 1 }} / {{ pages.length }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sm-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(6, 8, 14, 0.72);
  backdrop-filter: blur(20px) saturate(1.1);
  -webkit-backdrop-filter: blur(20px) saturate(1.1);
  user-select: none;
  touch-action: pan-y;
}
.sm-overlay.active { display: block; }

.sm-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-strong, rgba(128, 128, 128, 0.3));
  background: var(--panel, rgba(21, 25, 36, 0.88));
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.sm-close svg { width: 18px; height: 18px; }
.sm-close:hover { border-color: var(--accent, #7d8bf8); transform: rotate(90deg); }

.sm-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 28px 18px;
}

.sm-search {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--panel, rgba(21, 25, 36, 0.88));
  border: 1px solid var(--border-strong, rgba(128, 128, 128, 0.3));
  border-radius: 999px;
  padding: 13px 22px;
  flex-shrink: 0;
}
.sm-search:focus-within { border-color: var(--accent, #7d8bf8); }
.sm-search svg { width: 20px; height: 20px; opacity: 0.55; flex-shrink: 0; }
.sm-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 16.5px;
}
.sm-search input::placeholder { color: inherit; opacity: 0.4; }

.sm-subline {
  flex-shrink: 0;
  text-align: center;
  font-size: 12.5px;
  opacity: 0.55;
  padding: 12px 0 2px;
}
.sm-kbd { margin-left: 10px; opacity: 0.7; }

/* 结果舞台：固定剩余高度，翻页发生在舞台内；网格顶部对齐，末页不留空隙 */
.sm-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  margin-top: 14px;
  cursor: grab;
  overflow: hidden;
}
.sm-stage:active { cursor: grabbing; }

.sm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 14px 10px;
  align-content: start;   /* 关键：向上对齐，末页不满也贴顶 */
}
.sm-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 6px 9px;
  border-radius: 14px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  animation: smIn 0.28s var(--ease, ease) both;
}
@keyframes smIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.sm-card:hover {
  background: var(--accent-soft, rgba(125, 139, 248, 0.16));
  border-color: var(--accent, #7d8bf8);
  transform: translateY(-2px);
}

.sm-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.sm-icon img { width: 100%; height: 100%; object-fit: cover; }
.sm-icon-text {
  color: #fff;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1;
}
.sm-name {
  max-width: 100%;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sm-host {
  max-width: 100%;
  font-size: 11px;
  opacity: 0.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  opacity: 0.55;
  font-size: 14px;
  padding: 0 30px;
}

.sm-dots {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 7px;
  padding: 14px 0 6px;
}
.sm-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.25;
  transition: all 0.2s;
}
.sm-dot.on { opacity: 0.9; transform: scale(1.25); }
.sm-page-no { font-size: 12.5px; opacity: 0.6; }

.sm-flip-enter-active, .sm-flip-leave-active { transition: opacity 0.16s, transform 0.16s; }
.sm-flip-enter-from { opacity: 0; transform: translateX(18px); }
.sm-flip-leave-to { opacity: 0; transform: translateX(-18px); }

@media (max-width: 640px) {
  .sm-wrap { padding: 26px 14px 12px; }
  .sm-kbd { display: none; }
}
</style>
