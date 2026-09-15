<script setup>
import { ref, computed, inject } from 'vue'
import { BUILTIN_CATEGORIES, BUILTIN_SITES } from '../data/builtinSites'

const props = defineProps({
  visible: Boolean,
  services: { type: Array, required: true },
})

const emit = defineEmits(['close', 'added'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')

const q = ref('')
const activeCat = ref('popular')
// 图标加载失败的站点（按 url 记录）→ 卡片回退首字头像
const brokenIcons = ref(new Set())

const counts = computed(() => {
  const m = {}
  for (const s of BUILTIN_SITES) m[s.cat] = (m[s.cat] || 0) + 1
  return m
})

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (kw) {
    return BUILTIN_SITES.filter(
      (s) =>
        s.name.toLowerCase().includes(kw) ||
        s.url.toLowerCase().includes(kw) ||
        (s.desc || '').toLowerCase().includes(kw)
    )
  }
  return BUILTIN_SITES.filter((s) => s.cat === activeCat.value)
})

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
      group: BUILTIN_CATEGORIES.find((c) => c.key === site.cat)?.group || '',
      iconType: 'url',
      icon: site.icon,
    })
    emit('added')
    showToast(`已添加「${site.name}」`)
  })
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <div class="modal-overlay" :class="{ active: visible }" @click="handleOverlayClick">
    <div class="modal builtin-modal" @click.stop>
      <div class="modal-header">
        <h2>内置导航</h2>
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
        <input v-model="q" type="text" class="form-input" placeholder="搜索站点名称或网址" />
      </div>

      <div class="builtin-body">
        <aside class="builtin-rail">
          <button
            v-for="c in BUILTIN_CATEGORIES"
            :key="c.key"
            type="button"
            :class="{ active: !q.trim() && c.key === activeCat }"
            @click="activeCat = c.key"
          >
            {{ c.name }}
            <span class="cat-count">{{ counts[c.key] || 0 }}</span>
          </button>
        </aside>

        <div class="builtin-list">
          <div v-if="q.trim()" class="builtin-list-head">搜索「{{ q.trim() }}」— {{ filtered.length }} 个结果</div>
          <div v-for="s in filtered" :key="s.cat + s.url" class="builtin-card">
            <img
              v-if="!brokenIcons.has(s.url)"
              class="builtin-icon"
              :src="s.icon"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="onIconError(s)"
            >
            <span v-else class="builtin-icon fallback">{{ s.name.charAt(0) }}</span>
            <div class="builtin-meta">
              <b>{{ s.name }}</b>
              <p>{{ s.desc }}</p>
            </div>
            <button class="builtin-add" :disabled="isAdded(s)" @click="add(s)">
              {{ isAdded(s) ? '已添加' : '添加' }}
            </button>
          </div>
          <div v-if="!filtered.length" class="builtin-empty">
            没有匹配「{{ q.trim() }}」的站点
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
  width: 128px;
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
.cat-count { font-size: 0.72rem; color: var(--text-3); }

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
.builtin-empty { text-align: center; padding: 40px 0; }

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
