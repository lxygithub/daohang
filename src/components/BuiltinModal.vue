<script setup>
import { ref, computed, inject, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { textIconChars } from '../utils/textIcon'
import { iconSrc } from '../utils/iconUrl'

// 内置导航：数据源为站点库 API（/api/builtin-sites，PostgreSQL 全量库 1.9w+ 站点，
// 图标为图床外链）。受欢迎的 = 全库按 rate 降序首页；分类 = builtin_site_cats 过滤。
// 「受欢迎的」分类刻意与细分分类重复收录；去重由本组件按 URL 判定（已添加置灰）。
const props = defineProps({
  visible: Boolean,
  services: { type: Array, required: true },
})

const emit = defineEmits(['close', 'added'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')

// 侧栏分类：popular 为特殊页签（全库热门，不带 cat 过滤）；其余与 API cats 一一对应。
const CATS = [
  { key: 'popular', name: '受欢迎的', group: '常用' },
  { key: 'app', name: '实用应用', group: '实用应用' },
  { key: 'news', name: '新闻资讯', group: '新闻资讯' },
  { key: 'music', name: '影音音乐', group: '影音' },
  { key: 'photos', name: '图片设计', group: '图片设计' },
  { key: 'shopping', name: '购物与团购', group: '购物' },
  { key: 'social', name: '社交与博客', group: '社交' },
  { key: 'sports', name: '体育与旅行', group: '体育旅行' },
  { key: 'life', name: '生活方式', group: '生活' },
  { key: 'games', name: '游戏与娱乐', group: '游戏' },
  { key: 'education', name: '教育与招聘', group: '教育求职' },
  { key: 'tech', name: '数码科技', group: '数码科技' },
  { key: 'finance', name: '金融理财', group: '金融' },
  { key: 'read', name: '阅读小说', group: '阅读' },
  { key: 'others', name: '其他站点', group: '其他' },
]
const CAT_GROUP = Object.fromEntries(CATS.map(c => [c.key, c.group]))

const PAGE_SIZE = 60

const q = ref('')
const activeCat = ref('popular')
const items = ref([])
const total = ref(0)
const count = ref(0)
const catCounts = ref({})
const loading = ref(false)
const failed = ref(false)
const inited = ref(false)
// 图标加载失败的站点（按 url 记录）→ 卡片回退首字头像
const brokenIcons = ref(new Set())

let searchTimer = null
let seq = 0 // 竞态守卫：仅采纳最新一次请求的结果
let page = 1

const listEl = ref(null)
const sentinelEl = ref(null)
let observer = null

const canMore = computed(() => inited.value && !loading.value && items.value.length < total.value)

async function load(reset = false) {
  const my = ++seq
  if (reset) { page = 1; items.value = [] }
  loading.value = true
  failed.value = false
  try {
    // 搜索时忽略分类（全库检索）；popular 与搜索都不带 cat 参数
    const searching = q.value.trim().length > 0
    const cat = searching || activeCat.value === 'popular' ? '' : activeCat.value
    const p = new URLSearchParams({ page: page, pageSize: PAGE_SIZE })
    if (cat) p.set('cat', cat)
    if (searching) p.set('q', q.value.trim())
    if (reset) p.set('withCounts', '1')
    // 该接口允许浏览器缓存（Cloudflare 会把 max-age 改写成 zone 默认的 4 小时），
    // 带上构建版本号，保证每次发版都能拿到新数据（导入了新站点也要发版或强刷一次）
    p.set('v', String(__BUILD_TIME__))
    const res = await fetch('/api/builtin-sites?' + p)
    const d = await res.json()
    if (my !== seq) return // 已被更新的请求取代
    if (!res.ok || !d.ok) throw new Error(d.error || '加载失败')
    items.value = reset ? (d.items || []) : items.value.concat(d.items || [])
    total.value = d.total || 0
    count.value = d.count || 0
    if (d.catCounts) catCounts.value = d.catCounts
    inited.value = true
  } catch {
    if (my === seq) failed.value = true
  } finally {
    if (my === seq) loading.value = false
  }
  // 列表渲染后（重新）挂载无限滚动哨兵；重复 observe 同一元素是无害的 no-op
  await nextTick()
  if (sentinelEl.value && observer) observer.observe(sentinelEl.value)
}

function railCount(key) {
  if (key === 'popular') return count.value
  return catCounts.value[key] || 0
}

function setCat(key) {
  if (activeCat.value === key && !q.value) return
  activeCat.value = key
  if (q.value) q.value = '' // 触发 watcher 立即回到该分类
  else load(true)
}

watch(q, (nv) => {
  clearTimeout(searchTimer)
  if (!nv.trim()) { load(true); return } // 清空关键词 → 立即回到当前分类
  searchTimer = setTimeout(() => load(true), 400)
})

watch(() => props.visible, (v) => {
  if (!v) return
  activeCat.value = 'popular'
  brokenIcons.value = new Set()
  if (q.value) q.value = '' // 触发 watcher 回到默认分类并加载
  else load(true)
})

function more() {
  if (!canMore.value) return
  page++
  load(false)
}

function normUrl(u) {
  try {
    const x = new URL(u)
    return x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search
  } catch {
    return String(u || '').replace(/\/$/, '')
  }
}

const existingUrls = computed(() => {
  const set = new Set()
  for (const s of props.services) set.add(normUrl(s.url))
  return set
})

function isAdded(site) {
  return existingUrls.value.has(normUrl(site.url))
}

function onIconError(site) {
  const next = new Set(brokenIcons.value)
  next.add(site.url)
  brokenIcons.value = next
}

function add(site) {
  if (isAdded(site)) return
  ensureVerified(() => {
    props.services.push({
      id: 'svc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: site.name,
      url: site.url,
      group: CAT_GROUP[site.cats?.[0]] || '',
      iconType: 'url',
      icon: site.icon || '',
    })
    emit('added')
    showToast(`已添加「${site.name}」`)
  })
}

// 无限滚动：列表滚到底部自动翻页（IntersectionObserver 兜底「加载更多」按钮）
onMounted(async () => {
  await nextTick()
  if (!sentinelEl.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) more()
  }, { root: listEl.value, rootMargin: '200px' })
  observer.observe(sentinelEl.value)
})
onBeforeUnmount(() => { observer?.disconnect(); clearTimeout(searchTimer) })

function hue(name) {
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <div class="modal-overlay" :class="{ active: visible }" @click="handleOverlayClick">
    <div class="modal builtin-modal" @click.stop>
      <div class="modal-header">
        <h2>内置导航 <span v-if="count" class="builtin-total">共 {{ count.toLocaleString() }} 个站点</span></h2>
        <button class="modal-close" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="builtin-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input v-model="q" type="text" class="form-input" placeholder="搜索全库站点名称或网址，如：知乎 / github" />
      </div>

      <div class="builtin-body">
        <aside class="builtin-rail">
          <button
            v-for="c in CATS"
            :key="c.key"
            type="button"
            :class="{ active: !q.trim() && c.key === activeCat }"
            @click="setCat(c.key)"
          >
            {{ c.name }}
            <span class="cat-count">{{ railCount(c.key).toLocaleString() }}</span>
          </button>
        </aside>

        <div ref="listEl" class="builtin-list">
          <div v-if="q.trim()" class="builtin-list-head">搜索「{{ q.trim() }}」— {{ total.toLocaleString() }} 个结果</div>

          <template v-if="items.length">
            <div v-for="(s, i) in items" :key="s.url + i" class="builtin-card">
              <img
                v-if="s.icon && !brokenIcons.has(s.url)"
                class="builtin-icon"
                :src="iconSrc(s.icon)"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="onIconError(s)"
              >
              <span
                v-else
                class="builtin-icon fallback"
                :style="{ '--h': hue(s.name) }"
              >{{ textIconChars(s.name) }}</span>
              <div class="builtin-meta">
                <b>{{ s.name }}</b>
                <p>{{ s.description || s.url }}</p>
              </div>
              <button class="builtin-add" :disabled="isAdded(s)" @click="add(s)">
                {{ isAdded(s) ? '已添加' : '添加' }}
              </button>
            </div>
            <div ref="sentinelEl" class="builtin-sentinel"></div>
            <div v-if="items.length < total" class="builtin-more-wrap">
              <button class="builtin-add" :disabled="loading" @click="more">
                {{ loading ? '加载中…' : '加载更多' }}
              </button>
              <span class="builtin-hint">已显示 {{ items.length.toLocaleString() }} / {{ total.toLocaleString() }}</span>
            </div>
          </template>

          <div v-else-if="loading" class="builtin-cards-skel">
            <div v-for="n in 8" :key="'sk' + n" class="builtin-card skel"></div>
          </div>

          <div v-else-if="failed" class="builtin-empty">
            站点库加载失败
            <button class="builtin-add retry" @click="load(true)">重试</button>
          </div>

          <div v-else-if="inited" class="builtin-empty">
            {{ q.trim() ? `没有匹配「${q.trim()}」的站点，换个关键词试试` : '该分类暂无站点' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.builtin-modal {
  max-width: 780px;
  height: min(78vh, 620px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 24px;
}
.modal-header { margin-bottom: 14px; }
.builtin-total { font-size: 0.78rem; font-weight: 400; opacity: 0.55; margin-left: 8px; }

.builtin-search {
  position: relative;
  margin-bottom: 14px;
  flex: none;
}
.builtin-search svg {
  position: absolute;
  left: 12px;
  top: 50%;
  width: 15px;
  height: 15px;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.builtin-search .form-input { padding-left: 34px; }

.builtin-body {
  display: flex;
  gap: 14px;
  flex: 1;
  min-height: 0;
}

.builtin-rail {
  flex: none;
  width: 148px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-right: 4px;
}
.builtin-rail button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 11px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-2);
  font-size: 0.86rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  flex: none;
}
.builtin-rail button:hover { background: var(--surface-hover); color: var(--text); }
.builtin-rail button.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(125, 139, 248, 0.25);
  font-weight: 600;
}
.cat-count { font-size: 0.72rem; color: var(--text-3); font-variant-numeric: tabular-nums; }

.builtin-list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-right: 4px;
}
.builtin-list-head,
.builtin-empty,
.builtin-hint {
  flex: none;
  color: var(--text-3);
  font-size: 0.8rem;
}
.builtin-empty { text-align: center; padding: 40px 0; display: flex; flex-direction: column; align-items: center; gap: 12px; }

.builtin-card {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 13px;
  transition: background 0.15s, border-color 0.15s;
}
.builtin-card:hover { background: var(--surface-hover); border-color: var(--border-strong); }
.builtin-card.skel { height: 60px; animation: builtinPulse 1.2s ease-in-out infinite; }
@keyframes builtinPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }

.builtin-icon {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.06);
  padding: 4px;
}
.builtin-icon.fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 1rem;
  background: linear-gradient(135deg, hsl(calc(var(--h, 220) * 1deg), 45%, 55%), hsl(calc(var(--h, 220) * 1deg + 40deg), 50%, 45%));
}

.builtin-meta { flex: 1; min-width: 0; }
.builtin-meta b {
  display: block;
  font-size: 0.92rem;
  color: var(--text);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.builtin-meta p {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-2);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.builtin-add {
  flex: none;
  padding: 6px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.builtin-add:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.builtin-add:disabled {
  opacity: 0.45;
  cursor: default;
}

.builtin-sentinel { flex: none; height: 1px; }
.builtin-more-wrap {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 6px 0 10px;
}

@media (max-width: 700px) {
  .builtin-modal { height: 86vh; padding: 18px; }
  .builtin-body { flex-direction: column; gap: 10px; }
  .builtin-rail {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
  }
  .builtin-rail button { flex: none; border: 1px solid var(--border); }
  .builtin-list-head, .builtin-hint { display: none; }
}
</style>
