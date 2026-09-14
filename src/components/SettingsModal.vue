<script setup>
import { ref, watch, computed, inject } from 'vue'
import { BG_PRESETS } from '../data/presets'
import {
  LAYOUTS, loadLayout, saveLayout, emitLayout,
  loadGrid, saveGrid, emitGrid, pxToPct, pctToPx,
  loadFont, saveFont, applyFont,
} from '../composables/usePrefs'

const props = defineProps({
  visible: Boolean,
  background: { type: Object, default: null },
})

const emit = defineEmits(['close', 'saved'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')
const configRef = inject('config')
const saveConfig = inject('saveConfig')
const setWallpaper = inject('setWallpaper', null)

const SORT_KEY = 'nav_sort_usage'
const sortUsage = ref(localStorage.getItem(SORT_KEY) === '1')
const layout = ref(loadLayout())
const grid = ref(loadGrid())
const font = ref(loadFont())
const wallpaperUrl = ref('')
const wpBlur = ref(0)

// 图标大小滑条以百分比展示：10% = 48px，100% = 500px
const sizePct = computed(() => pxToPct(grid.value.size))

function onSizeSlider(e) {
  grid.value = { ...grid.value, size: pctToPx(e.target.value) }
  onGridChange()
}

// ---- 字体调节（图标文字） ----
const FONT_COLORS = ['#ffffff', '#ff5d5d', '#ff9f43', '#ffd93d', '#6BCB77', '#4ECDC4', '#54A0FF', '#A55EEA']
const customFontColor = ref('#ffffff')

function onFontChange() {
  font.value = { ...font.value }
  saveFont(font.value)
  applyFont(font.value)
}

function pickFontColor(c) {
  font.value.color = c
  customFontColor.value = c
  onFontChange()
}

function pickCustomFontColor(e) {
  pickFontColor(e.target.value)
}

// ---- 可视化渐变编辑器（无需写代码） ----
const gradC1 = ref('#0f1424')
const gradC2 = ref('#3b2a58')
const gradAngle = ref(160)
const solidColor = ref('#141414')

const GRAD_DIRS = [
  { angle: 0, arrow: '↑' },
  { angle: 45, arrow: '↗' },
  { angle: 90, arrow: '→' },
  { angle: 135, arrow: '↘' },
  { angle: 180, arrow: '↓' },
  { angle: 225, arrow: '↙' },
  { angle: 270, arrow: '←' },
  { angle: 315, arrow: '↖' },
]

const gradCss = computed(() => `linear-gradient(${gradAngle.value}deg, ${gradC1.value} 0%, ${gradC2.value} 100%)`)

function applyBackgroundValue(css) {
  document.body.style.background = css
  props.background.type = 'color'
  props.background.value = css
  emit('saved')
}

function applyGradient() {
  ensureVerified(() => {
    applyBackgroundValue(gradCss.value)
    showToast('渐变背景已应用')
  })
}

function applySolid() {
  ensureVerified(() => {
    applyBackgroundValue(solidColor.value)
    showToast('纯色背景已应用')
  })
}

watch(() => props.visible, (val) => {
  if (!val) return
  if (props.background?.value) {
    // 回填当前背景：若为双色线性渐变则解析到编辑器
    const m = String(props.background.value).match(/^linear-gradient\((\d+)deg,\s*(#[0-9a-fA-F]{3,8})\s+0%,\s*(#[0-9a-fA-F]{3,8})/)
    if (m) {
      gradAngle.value = Number(m[1]) || 160
      gradC1.value = m[2]
      gradC2.value = m[3]
    } else if (/^#[0-9a-fA-F]{3,8}$/.test(props.background.value)) {
      solidColor.value = props.background.value
    }
  }
  const cfg = configRef?.value
  const wp = cfg?.wallpaper
  wallpaperUrl.value = wp && wp.type === 'url' ? (wp.value || '') : ''
  wpBlur.value = Number(cfg?.wallpaperBlur) || 0
})

function selectPreset(bg) {
  ensureVerified(() => {
    applyBackgroundValue(bg.value)
  })
}

function resetDefault() {
  ensureVerified(() => {
    applyBackgroundValue('#0d1017')
    showToast('已恢复默认背景')
  })
}

function confirm() {
  emit('saved')
  emit('close')
}

// ---- 使用频率排序 ----
function onSortUsageChange() {
  localStorage.setItem(SORT_KEY, sortUsage.value ? '1' : '0')
  window.dispatchEvent(new CustomEvent('usage-sort-changed', { detail: sortUsage.value }))
}

// ---- 布局切换 ----
function setLayout(v) {
  layout.value = v
  saveLayout(v)
  emitLayout(v)
}

// ---- 手机网格：行/列/尺寸 ----
function onGridChange() {
  saveGrid(grid.value)
  emitGrid(grid.value)
}

// 列数下限 2，配合超大图标（最大 500px）留出足够宽度
const COLS_MIN = 2

// ---- 壁纸 ----
const hasWallpaper = computed(() => {
  const wp = configRef?.value?.wallpaper
  return !!(wp && wp.type !== 'none' && wp.value)
})

function applyWallpaper(value, type) {
  ensureVerified(() => {
    if (setWallpaper) {
      setWallpaper(value || '')
    } else {
      const cfg = configRef?.value
      if (!cfg) return
      cfg.wallpaper = value ? { type, value } : { type: 'none', value: '' }
      saveConfig()
      window.dispatchEvent(new CustomEvent('apply-background'))
    }
    showToast(value ? '壁纸已更新' : '壁纸已清除')
  })
}

const wpLoading = ref(false)

async function randomWallpaper() {
  if (wpLoading.value) return
  wpLoading.value = true
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    const res = await fetch('/api/wallpaper', { signal: ctrl.signal })
    clearTimeout(timer)
    const d = await res.json()
    if (!d.url) throw new Error('no url')
    ensureVerified(() => {
      if (setWallpaper) setWallpaper(d.url)
      showToast('壁纸已更换')
    })
  } catch {
    showToast('获取壁纸失败，请稍后再试')
  } finally {
    wpLoading.value = false
  }
}

function confirmWallpaperUrl() {
  const u = wallpaperUrl.value.trim()
  applyWallpaper(u || '', u ? 'url' : 'none')
}

function clearWallpaper() {
  wallpaperUrl.value = ''
  wpBlur.value = 0
  applyWallpaper('', 'none')
}

function previewBlur() {
  const cfg = configRef?.value
  if (!cfg) return
  cfg.wallpaperBlur = Number(wpBlur.value) || 0
  window.dispatchEvent(new CustomEvent('apply-background'))
}

function saveBlur() {
  ensureVerified(() => {
    const cfg = configRef?.value
    if (!cfg) return
    cfg.wallpaperBlur = Number(wpBlur.value) || 0
    saveConfig()
    showToast('模糊度已保存')
  })
}

function pickWallpaper() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        // 压缩到最长边 1440，减少 D1 存储体积
        const MAX = 1440
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
        applyWallpaper(dataUrl, 'data')
      }
      img.onerror = () => showToast('图片读取失败')
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

// ---- 回收站 ----
const trashItems = computed(() => configRef?.value?.trash || [])

function restoreTrash(i) {
  ensureVerified(() => {
    const cfg = configRef?.value
    if (!cfg) return
    const [item] = cfg.trash.splice(i, 1)
    if (item) {
      if (cfg.services.some(s => s.id === item.id)) {
        item.id = item.id + '-r' + Date.now()
      }
      cfg.services.push(item)
      saveConfig()
      showToast(`已恢复「${item.name}」`)
    }
  })
}

function purgeTrash(i) {
  ensureVerified(() => {
    const cfg = configRef?.value
    if (!cfg) return
    const [item] = cfg.trash.splice(i, 1)
    if (item) {
      saveConfig()
      showToast('已永久删除')
    }
  })
}

function emptyTrash() {
  ensureVerified(() => {
    const cfg = configRef?.value
    if (!cfg || !cfg.trash?.length) return
    cfg.trash = []
    saveConfig()
    showToast('回收站已清空')
  })
}

// ---- 导入 / 导出 ----
function exportConfig() {
  const cfg = configRef?.value
  if (!cfg) return
  const data = {
    app: 'daohang',
    version: 3,
    exportedAt: new Date().toISOString(),
    services: cfg.services || [],
    background: cfg.background || null,
    wallpaper: cfg.wallpaper || null,
    wallpaperBlur: cfg.wallpaperBlur || 0,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  a.href = url
  a.download = `nav-config-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast('配置已导出')
}

function pickImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!Array.isArray(data.services)) {
        showToast('文件格式不正确')
        return
      }
      ensureVerified(() => {
        const cfg = configRef?.value
        if (!cfg) return
        cfg.services = data.services.filter(s => s && s.name && s.url)
        if (data.background && typeof data.background === 'object') {
          cfg.background = data.background
          document.body.style.background = data.background.value || ''
        }
        if (data.wallpaper !== undefined) {
          cfg.wallpaper = data.wallpaper
        }
        if (data.wallpaperBlur !== undefined) {
          cfg.wallpaperBlur = Number(data.wallpaperBlur) || 0
        }
        saveConfig()
        window.dispatchEvent(new CustomEvent('apply-background'))
        showToast(`已导入 ${cfg.services.length} 个服务`)
        emit('close')
      })
    } catch {
      showToast('导入失败，请检查文件')
    }
  }
  input.click()
}

</script>

<template>
  <!-- 透明点击拦截层：点击抽屉外任意处关闭，但不遮挡/变暗主页面 -->
  <div class="drawer-catch" :class="{ open: visible }" @click="emit('close')"></div>

  <!-- 右侧滑出设置抽屉 -->
  <aside class="settings-drawer" :class="{ open: visible }" role="dialog" aria-label="设置">
    <div class="drawer-header">
      <h2>设置</h2>
      <button class="modal-close" title="关闭" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

      <div class="form-group">
        <label>背景主题</label>
        <div class="bg-presets">
          <div
            v-for="bg in BG_PRESETS"
            :key="bg.name"
            class="bg-preset-item"
            :class="{ selected: background && background.value === bg.value }"
            :title="bg.name"
            @click="selectPreset(bg)"
          >
            <div class="bg-preset-swatch" :style="{ background: bg.value }"></div>
            <div class="bg-preset-name">{{ bg.name }}</div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label>自定义渐变</label>
        <div class="grad-builder">
          <div class="grad-preview" :style="{ background: gradCss }"></div>
          <div class="grad-controls">
            <div class="grad-colors">
              <input type="color" v-model="gradC1" class="color-input" title="起始颜色">
              <div class="grad-dirs">
                <button
                  v-for="d in GRAD_DIRS"
                  :key="d.angle"
                  type="button"
                  class="grad-dir"
                  :class="{ active: gradAngle === d.angle }"
                  :title="`${d.angle}°`"
                  @click="gradAngle = d.angle"
                >{{ d.arrow }}</button>
              </div>
              <input type="color" v-model="gradC2" class="color-input" title="结束颜色">
            </div>
            <button class="btn-text primary grad-apply" @click="applyGradient">应用渐变</button>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label>纯色背景</label>
        <div class="solid-row">
          <input type="color" v-model="solidColor" class="color-input" title="选择颜色">
          <button class="btn-text fetch-btn" @click="applySolid">应用纯色</button>
        </div>
      </div>

      <div class="form-group">
        <label>布局</label>
        <div class="seg-row">
          <button
            v-for="l in LAYOUTS"
            :key="l.id"
            class="seg-btn"
            :class="{ active: layout === l.id }"
            type="button"
            @click="setLayout(l.id)"
          >{{ l.name }}</button>
        </div>

        <!-- 手机图标网格调节 -->
        <div v-if="layout === 'phone'" class="grid-setting">
          <label class="slider-row">
            <span>每屏行数</span>
            <input type="range" min="2" max="7" step="1" v-model.number="grid.rows" @change="onGridChange">
            <b>{{ grid.rows }} 行</b>
          </label>
          <label class="slider-row">
            <span>每屏列数</span>
            <input type="range" :min="COLS_MIN" max="9" step="1" v-model.number="grid.cols" @change="onGridChange">
            <b>{{ grid.cols }} 列</b>
          </label>
          <label class="slider-row">
            <span>图标大小</span>
            <input type="range" min="10" max="100" step="1" :value="sizePct" @input="onSizeSlider">
            <b>{{ sizePct }}%</b>
          </label>
          <p class="settings-hint">10% = 48px，100% = 500px；图标超出列宽时自动适配，可减小列数放大图标</p>
        </div>
      </div>

      <div class="form-group">
        <label>字体</label>
        <div class="font-setting">
          <label class="switch-row">
            <span class="switch-label">字体阴影</span>
            <input type="checkbox" v-model="font.shadow" @change="onFontChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="slider-row">
            <span>字体大小</span>
            <input type="range" min="12" max="30" step="1" v-model.number="font.size" @input="onFontChange">
            <b>{{ font.size }}</b>
          </label>
          <div class="font-color-row">
            <span class="font-color-label">字体颜色</span>
            <div class="font-swatches">
              <button
                v-for="c in FONT_COLORS"
                :key="c"
                type="button"
                class="font-swatch"
                :class="{ selected: font.color === c }"
                :style="{ background: c }"
                :title="c"
                @click="pickFontColor(c)"
              ></button>
              <label class="font-swatch custom" title="自定义颜色">
                <input type="color" :value="customFontColor" @input="pickCustomFontColor">
              </label>
            </div>
            <button v-if="font.color" class="font-reset" type="button" @click="pickFontColor('')">重置</button>
          </div>
          <p class="settings-hint">调整图标下方文字的大小、阴影与颜色，图标与文字始终保持间距</p>
        </div>
      </div>

      <div class="form-group">
        <label>壁纸</label>
        <div class="input-row">
          <input
            type="text"
            class="form-input"
            v-model="wallpaperUrl"
            placeholder="图片 URL，留空不使用"
            @keydown.enter="confirmWallpaperUrl"
          >
          <button class="btn-text fetch-btn" @click="confirmWallpaperUrl">应用</button>
        </div>
        <div class="backup-row" style="margin-top:10px">
          <button class="btn-text ghost" :class="{ loading: wpLoading }" :disabled="wpLoading" @click="randomWallpaper">{{ wpLoading ? '获取中…' : '随机壁纸' }}</button>
          <button class="btn-text ghost" @click="pickWallpaper">上传图片</button>
          <button class="btn-text ghost" @click="clearWallpaper">清除壁纸</button>
        </div>
        <div v-if="hasWallpaper" class="grid-setting">
          <label class="slider-row">
            <span>模糊度</span>
            <input type="range" min="0" max="30" step="1" v-model.number="wpBlur" @input="previewBlur" @change="saveBlur">
            <b>{{ wpBlur }}px</b>
          </label>
        </div>
        <p class="settings-hint">上传自动压缩至 1440px；启用壁纸后极光背景会淡出</p>
      </div>

      <div class="form-group">
        <label>排序</label>
        <label class="switch-row">
          <span class="switch-label">按使用频率排序<span class="label-hint">（本机生效，开启后忽略手动排序）</span></span>
          <input type="checkbox" v-model="sortUsage" @change="onSortUsageChange">
          <span class="switch" aria-hidden="true"></span>
        </label>
      </div>

      <div v-if="trashItems.length" class="form-group">
        <label>回收站 <span class="label-hint">（最多保留 30 条）</span></label>
        <div class="trash-list">
          <div v-for="(t, i) in trashItems" :key="t.id + '-' + i" class="trash-item">
            <span class="trash-name">{{ t.name }}</span>
            <span class="trash-host">{{ t.url }}</span>
            <div class="trash-actions">
              <button class="btn-text ghost trash-btn" @click="restoreTrash(i)">恢复</button>
              <button class="btn-text ghost trash-btn danger" @click="purgeTrash(i)">删除</button>
            </div>
          </div>
        </div>
        <button class="btn-text ghost trash-empty" @click="emptyTrash">清空回收站</button>
      </div>

      <div class="form-group">
        <label>备份</label>
        <div class="backup-row">
          <button class="btn-text ghost" @click="exportConfig">导出配置</button>
          <button class="btn-text ghost" @click="pickImport">导入配置</button>
        </div>
        <p class="settings-hint">导出包含全部服务与背景设置，导入将覆盖当前数据</p>
      </div>

      <div class="drawer-footer">
        <button class="btn-text ghost" @click="resetDefault">恢复默认</button>
        <button class="btn-text primary" @click="confirm">完成</button>
      </div>
  </aside>
</template>
