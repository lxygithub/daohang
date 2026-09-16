<script setup>
import { ref, watch } from 'vue'
import { textIconChars } from '../utils/textIcon'

// 站点库选择器：从内置导航（D1 站点库）搜索/浏览并挑选站点。
// 选中后把 name/url/icon 回填给父级（EditModal），可继续修改再保存。
const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'pick'])

const CAT_LABELS = {
  app: '应用', news: '资讯', music: '音乐', photos: '图片', shopping: '购物',
  social: '社交', sports: '体育', life: '生活', games: '游戏', education: '教育',
  tech: '技术', finance: '财经', read: '阅读', others: '其他',
}

const cat = ref('')
const q = ref('')
const items = ref([])
const total = ref(0)
const count = ref(0)
const page = ref(1)
const loading = ref(false)
const inited = ref(false)
const failed = ref(false)
let searchTimer = null
let seq = 0

const PAGE_SIZE = 60

async function load(reset = false) {
  const my = ++seq
  if (reset) { page.value = 1; items.value = [] }
  loading.value = true
  failed.value = false
  try {
    const p = new URLSearchParams({ page: page.value, pageSize: PAGE_SIZE })
    if (cat.value) p.set('cat', cat.value)
    if (q.value.trim()) p.set('q', q.value.trim())
    const res = await fetch('/api/builtin-sites?' + p)
    const d = await res.json()
    if (my !== seq) return // 已被更新的请求取代
    if (!res.ok || !d.ok) throw new Error(d.error || '加载失败')
    items.value = reset ? d.items : items.value.concat(d.items)
    total.value = d.total || 0
    count.value = d.count || 0
    inited.value = true
  } catch {
    if (my === seq) failed.value = true
  } finally {
    if (my === seq) loading.value = false
  }
}

function setCat(c) {
  if (cat.value === c) return
  cat.value = c
  load(true)
}

watch(q, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(true), 400)
})

watch(() => props.visible, (v) => {
  if (!v) return
  cat.value = ''
  q.value = ''
  items.value = []
  total.value = 0
  inited.value = false
  load(true)
})

function more() {
  if (loading.value || items.value.length >= total.value) return
  page.value++
  load(false)
}

function pick(item) {
  emit('pick', {
    name: item.name,
    url: item.url,
    icon: item.icon || '',
    description: item.description || '',
    suggestedGroup: cat.value ? (CAT_LABELS[cat.value] || '') : '',
  })
}

function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u }
}

function hue(name) {
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
</script>

<template>
  <div class="modal-overlay lib-overlay" :class="{ active: visible }" @click.self="emit('close')">
    <div class="modal site-library">
      <div class="modal-header">
        <h2>站点库 <span class="lib-count" v-if="count">共 {{ count.toLocaleString() }} 个站点</span></h2>
        <button class="modal-close" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="lib-search">
        <input
          type="text" class="form-input" v-model="q"
          placeholder="搜索站点名称或网址，如：知乎 / github"
        >
      </div>

      <div class="lib-cats">
        <button
          class="lib-cat" :class="{ on: cat === '' }"
          @click="setCat('')"
        >全部</button>
        <button
          v-for="(label, key) in CAT_LABELS" :key="key"
          class="lib-cat" :class="{ on: cat === key }"
          @click="setCat(key)"
        >{{ label }}</button>
      </div>

      <div class="lib-body">
        <div v-if="failed && !items.length" class="lib-empty">站点库加载失败，请稍后重试</div>
        <div v-else-if="inited && !items.length && !loading" class="lib-empty">
          {{ q ? '没有匹配的站点，换个关键词试试' : '该分类暂无站点' }}
        </div>
        <div v-else class="lib-grid">
          <button
            v-for="(it, i) in items" :key="it.url + i"
            class="lib-item" :title="it.description || it.name"
            @click="pick(it)"
          >
            <img
              v-if="it.icon" :src="it.icon" class="lib-icon" loading="lazy"
              referrerpolicy="no-referrer"
              @error="$event.target.style.display = 'none'"
            >
            <span v-if="!it.icon" class="lib-icon lib-icon-ph" :style="{ background: `hsl(${hue(it.name)} 45% 42%)` }">
              {{ textIconChars(it.name) }}
            </span>
            <span class="lib-name">{{ it.name }}</span>
            <span class="lib-host">{{ host(it.url) }}</span>
          </button>
          <template v-if="loading">
            <div v-for="n in 12" :key="'sk' + n" class="lib-item lib-skeleton"></div>
          </template>
        </div>
      </div>

      <div class="lib-footer" v-if="items.length < total || items.length">
        <span class="lib-hint">{{ items.length ? `已显示 ${items.length} / ${total}` : '' }}</span>
        <button
          v-if="items.length < total" class="btn-text more-btn"
          :disabled="loading" @click="more"
        >{{ loading ? '加载中…' : '加载更多' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lib-overlay { z-index: 60; }
.site-library { display: flex; flex-direction: column; max-height: min(78vh, 640px); padding: 0; }
.lib-count { font-size: 12px; font-weight: 400; opacity: 0.55; margin-left: 8px; }
.lib-search { padding: 12px 20px 4px; }
.lib-search .form-input { width: 100%; }
.lib-cats { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 20px; }
.lib-cat {
  border: 1px solid var(--stroke, rgba(128, 128, 128, 0.25));
  background: transparent; color: inherit; border-radius: 999px;
  padding: 4px 12px; font-size: 12.5px; cursor: pointer; transition: all 0.15s;
}
.lib-cat:hover { border-color: var(--accent, #6c8cff); }
.lib-cat.on { background: var(--accent, #6c8cff); border-color: var(--accent, #6c8cff); color: #fff; }
.lib-body { flex: 1; overflow-y: auto; padding: 4px 20px 12px; min-height: 220px; }
.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.lib-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 6px 8px; border-radius: 10px; border: 1px solid transparent;
  background: var(--card, rgba(128, 128, 128, 0.08)); color: inherit;
  cursor: pointer; text-align: center; transition: all 0.15s; overflow: hidden;
}
.lib-item:hover { border-color: var(--accent, #6c8cff); transform: translateY(-1px); }
.lib-icon { width: 36px; height: 36px; border-radius: 8px; object-fit: contain; background: rgba(255, 255, 255, 0.9); flex: none; }
.lib-icon-ph { display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 16px; }
.lib-name { font-size: 12.5px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lib-host { font-size: 10.5px; opacity: 0.5; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lib-skeleton { height: 78px; animation: libPulse 1.2s ease-in-out infinite; }
@keyframes libPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }
.lib-empty { text-align: center; opacity: 0.55; padding: 48px 0; font-size: 13.5px; }
.lib-footer { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px 20px 14px; }
.lib-hint { font-size: 12px; opacity: 0.5; }
.more-btn { font-size: 13px; }
</style>
