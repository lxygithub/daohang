<script setup>
import { computed } from 'vue'

const props = defineProps({
  visible: Boolean,
  favorites: { type: Array, default: () => [] },
  currentUrl: { type: String, default: '' },
})
const emit = defineEmits(['close', 'apply', 'remove'])

function hostOf(url) {
  const s = String(url || '')
  if (s.startsWith('data:')) return '本地图片'
  try { return new URL(s).hostname.replace(/^www\./, '') } catch { return s.slice(0, 40) }
}
function titleOf(item) {
  return item?.title || hostOf(item?.url)
}
const isCurrent = (url) => !!url && url === props.currentUrl

const count = computed(() => props.favorites.length)
</script>

<template>
  <div class="modal-overlay" :class="{ active: visible }" @click.self="emit('close')">
    <div class="modal modal-lg wp-fav-modal" role="dialog" aria-label="我收藏的壁纸">
      <div class="modal-header">
        <h2>我收藏的壁纸 <span class="wp-fav-count">{{ count }}</span></h2>
        <button class="modal-close" type="button" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div v-if="!count" class="wp-fav-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <div class="wp-fav-empty-title">还没有收藏的壁纸</div>
        <div class="wp-fav-empty-hint">看到喜欢的壁纸时，点右上角的 ♥ 就能收藏</div>
      </div>

      <div v-else class="wp-fav-grid">
        <div
          v-for="item in favorites"
          :key="item.url"
          class="wp-fav-item"
          :class="{ current: isCurrent(item.url) }"
        >
          <button
            type="button"
            class="wp-fav-thumb"
            :title="`应用壁纸：${titleOf(item)}`"
            @click="emit('apply', item.url)"
          >
            <img
              :src="item.url"
              :alt="titleOf(item)"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="$event.target.style.display = 'none'"
            >
            <span v-if="isCurrent(item.url)" class="wp-fav-using">使用中</span>
          </button>
          <div class="wp-fav-meta">
            <span class="wp-fav-title" :title="item.url">{{ titleOf(item) }}</span>
            <button
              type="button"
              class="wp-fav-remove"
              title="取消收藏"
              aria-label="取消收藏"
              @click="emit('remove', item.url)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <p v-if="count" class="wp-fav-footer-hint">点击壁纸即可应用 · 收藏随账号同步</p>
    </div>
  </div>
</template>

<style scoped>
.wp-fav-modal.modal-lg { max-width: 880px; }
.wp-fav-count {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent-soft, rgba(125, 139, 248, 0.16));
  color: var(--accent, #7d8bf8);
  font-size: 0.78rem;
  font-weight: 600;
  vertical-align: 2px;
}

.wp-fav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.wp-fav-item {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.035);
  transition: border-color 0.18s, transform 0.18s;
}
.wp-fav-item:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.wp-fav-item.current { border-color: var(--accent, #7d8bf8); }
html[data-theme="light"] .wp-fav-item { background: rgba(15, 23, 42, 0.04); }

.wp-fav-thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  padding: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.28);
  cursor: pointer;
  overflow: hidden;
}
.wp-fav-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.25s var(--ease, ease);
}
.wp-fav-thumb:hover img { transform: scale(1.04); }
.wp-fav-using {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent, #7d8bf8);
  color: #fff;
  font-size: 0.68rem;
  font-weight: 600;
}
.wp-fav-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
}
.wp-fav-title {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-fav-remove {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.wp-fav-remove:hover { background: rgba(255, 90, 90, 0.14); color: #ff6b6b; }
.wp-fav-remove svg { width: 13px; height: 13px; }

.wp-fav-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 46px 20px 38px;
  text-align: center;
}
.wp-fav-empty svg { width: 42px; height: 42px; opacity: 0.35; color: var(--text-3); }
.wp-fav-empty-title { font-size: 0.95rem; color: var(--text-2); }
.wp-fav-empty-hint { font-size: 0.78rem; color: var(--text-3); opacity: 0.8; }
.wp-fav-footer-hint {
  margin: 18px 0 0;
  text-align: center;
  font-size: 0.74rem;
  color: var(--text-3);
  opacity: 0.75;
}

@media (max-width: 640px) {
  .wp-fav-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
}
</style>
