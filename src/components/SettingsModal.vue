<script setup>
import { ref, watch, computed, inject } from 'vue'
import { BG_PRESETS } from '../data/presets'
import {
  LAYOUTS, loadLayout, saveLayout, emitLayout,
  loadGrid, saveGrid, emitGrid, pxToPct, pctToPx,
  loadFont, saveFont, applyFont,
  loadSearch, saveSearch, applySearch,
  loadHero, saveHero, applyHero,
} from '../composables/usePrefs'
import { probeImageBed, uploadImage, authed, userEmail, isAdmin } from '../composables/sync'
import { aiSettings, saveAiSettings, aiGroupSites, DEFAULT_AI } from '../composables/useAi'

const props = defineProps({
  visible: Boolean,
  background: { type: Object, default: null },
  // 明暗主题 / 同步状态由 App 管，设置里只做展示与转发
  light: { type: Boolean, default: false },
  syncing: { type: Boolean, default: false },
})

// 原先右上角那一排浮标的动作，现在全部由设置抽屉转发出去
const emit = defineEmits([
  'close', 'saved',
  'add-site', 'search-sites', 'builtin-library', 'toggle-theme', 'toggle-view',
  'login', 'account', 'admin', 'logout', 'sync',
])
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
// ---- 图床：上传走服务端代理换外链（未配置/失败自动回退 base64 内联） ----
const imgbedEnabled = ref(false)
const wpUploading = ref(false)
const migrating = ref(false)
const migrateProgress = ref('')

// 图标大小滑条以百分比展示：10% = 48px，100% = 500px
const sizePct = computed(() => pxToPct(grid.value.size))

// ---- AI 自动分组（Key 只在本机 localStorage；没配置就不启用）----
const aiForm = ref({ ...DEFAULT_AI, ...aiSettings.value })
const aiBusy = ref(false)
const aiProgress = ref('')
const aiReady = computed(() =>
  Boolean(aiForm.value.apiKey.trim() && aiForm.value.model.trim() && aiForm.value.apiBase.trim())
)

function saveAi() {
  saveAiSettings(aiForm.value)
  showToast('大模型设置已保存（只存在本机浏览器）')
}

async function runAiGroupAll() {
  if (aiBusy.value) return
  const services = configRef?.value?.services || []
  if (!services.length) { showToast('还没有站点'); return }
  if (!aiReady.value) { showToast('请先填好接口地址、模型名和 API Key'); return }
  saveAiSettings(aiForm.value) // 顺手落盘，免得改了没保存
  aiBusy.value = true
  try {
    const out = {}
    const CHUNK = 60 // 站点多的时候分批，免得一次塞太长拖慢/超时
    for (let i = 0; i < services.length; i += CHUNK) {
      const chunk = services.slice(i, i + CHUNK)
      aiProgress.value = `分组中 ${Math.min(i + CHUNK, services.length)}/${services.length}`
      const known = [...new Set([
        ...services.map(s => (s.group || '').trim()).filter(Boolean),
        ...Object.values(out),
      ])]
      const map = await aiGroupSites(chunk.map(s => ({ id: s.id, name: s.name, url: s.url })), known)
      Object.assign(out, map)
    }
    let n = 0
    for (const s of services) {
      const g = out[s.id]
      if (g) { s.group = g; n++ }
    }
    await saveConfig()
    emit('saved')
    showToast(n ? `AI 已为 ${n} 个站点分组` : 'AI 没有给出可用的分组')
  } catch (e) {
    showToast('AI 分组失败：' + (e?.message || ''))
  } finally {
    aiBusy.value = false
    aiProgress.value = ''
  }
}

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
  window.dispatchEvent(new CustomEvent('font-changed', { detail: { ...font.value } }))
}

function pickFontColor(c) {
  font.value.color = c
  customFontColor.value = c
  onFontChange()
}

function pickCustomFontColor(e) {
  pickFontColor(e.target.value)
}

// ---- 搜索框设置 ----
const searchPrefs = ref(loadSearch())

function onSearchChange() {
  searchPrefs.value = { ...searchPrefs.value }
  saveSearch(searchPrefs.value)
  applySearch(searchPrefs.value)
  window.dispatchEvent(new CustomEvent('search-changed', { detail: { ...searchPrefs.value } }))
}

// ---- 时间与名句 ----
const HERO_COLORS = ['#ffffff', '#a5adc2', '#ff5d5d', '#ff9f43', '#ffd93d', '#6BCB77', '#54A0FF', '#A55EEA']
const heroPrefs = ref(loadHero())
const customClockColor = ref(heroPrefs.value.clockColor || '#ffffff')
const customQuoteColor = ref(heroPrefs.value.quoteColor || '#a5adc2')

function onHeroChange() {
  heroPrefs.value = { ...heroPrefs.value }
  saveHero(heroPrefs.value)
  applyHero(heroPrefs.value)
  window.dispatchEvent(new CustomEvent('hero-changed'))
}

function pickClockColor(c) {
  heroPrefs.value.clockColor = c
  customClockColor.value = c || '#ffffff'
  onHeroChange()
}

function pickQuoteColor(c) {
  heroPrefs.value.quoteColor = c
  customQuoteColor.value = c || '#a5adc2'
  onHeroChange()
}

// ---- 自定义搜索引擎管理 ----
const CUSTOM_ENGINE_KEY = 'nav_custom_engines'
const customEngines = ref(loadEngines())
const newEngineName = ref('')
const newEngineUrl = ref('')

function loadEngines() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_ENGINE_KEY))
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

function persistEngines() {
  try { localStorage.setItem(CUSTOM_ENGINE_KEY, JSON.stringify(customEngines.value)) } catch {}
}

function addEngineFromSettings() {
  const n = newEngineName.value.trim()
  let u = newEngineUrl.value.trim()
  if (!n || !u) { showToast('请填写名称和搜索链接'); return }
  if (!/\{q\}/.test(u)) u = u.includes('?') ? `${u}&q={q}` : `${u}{q}`
  try { new URL(u.replace('{q}', 'test')) } catch { showToast('链接格式不正确'); return }
  let icon = ''
  try { icon = new URL(u.replace('{q}', '')).origin + '/favicon.ico' } catch {}
  customEngines.value = [...customEngines.value, { id: 'ce-' + Date.now(), name: n, url: u, icon }]
  persistEngines()
  window.dispatchEvent(new CustomEvent('custom-engines-changed'))
  newEngineName.value = ''
  newEngineUrl.value = ''
  showToast('搜索引擎已添加')
}

function removeEngineFromSettings(id) {
  customEngines.value = customEngines.value.filter(e => e.id !== id)
  persistEngines()
  window.dispatchEvent(new CustomEvent('custom-engines-changed'))
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
  probeImageBed().then(v => { imgbedEnabled.value = v })
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
      img.onload = async () => {
        // 压缩到最长边 1440，控制存储与上传体积
        const MAX = 1440
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
        // 未配置图床：沿用 base64 内联（原行为，无需登录）
        if (!imgbedEnabled.value) { applyWallpaper(dataUrl, 'data'); return }
        // 已配置图床：上传换外链，失败回退内联，绝不阻断
        wpUploading.value = true
        try {
          const blob = await (await fetch(dataUrl)).blob()
          const r = await uploadImage(new File([blob], 'wallpaper.jpg', { type: 'image/jpeg' }))
          if (r.ok && r.url) {
            applyWallpaper(r.url, 'url')
            showToast('壁纸已上传图床')
          } else {
            applyWallpaper(dataUrl, 'data')
            showToast((r.error || '图床上传失败') + '，已改用内联保存')
          }
        } catch {
          applyWallpaper(dataUrl, 'data')
          showToast('图床上传失败，已改用内联保存')
        } finally {
          wpUploading.value = false
        }
      }
      img.onerror = () => showToast('图片读取失败')
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

// ---- 存量 base64 一键转存图床（图标 + 壁纸） ----
const inlineAssets = computed(() => {
  const cfg = configRef?.value
  if (!cfg) return { icons: [], wallpaper: null }
  const icons = (cfg.services || []).filter(s => typeof s.icon === 'string' && s.icon.startsWith('data:'))
  const wp = cfg.wallpaper
  const wallpaper = wp && wp.type !== 'none' && typeof wp.value === 'string' && wp.value.startsWith('data:') ? wp : null
  return { icons, wallpaper }
})
const inlineCount = computed(() => inlineAssets.value.icons.length + (inlineAssets.value.wallpaper ? 1 : 0))

async function dataUrlToFile(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob()
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
  return new File([blob], `${name}.${ext}`, { type: blob.type || 'image/png' })
}

async function migrateInlineAssets() {
  if (migrating.value) return
  const cfg = configRef?.value
  if (!cfg) return
  if (!authed.value) { showToast('请先注册并登录，再转存到图床'); return }
  const { icons, wallpaper } = inlineAssets.value
  const total = icons.length + (wallpaper ? 1 : 0)
  if (!total) { showToast('没有内联保存的图标或壁纸'); return }
  migrating.value = true
  const seen = new Map() // 相同 base64 只上传一次
  let done = 0, ok = 0, fail = 0
  for (const s of icons) {
    migrateProgress.value = `${done + 1} / ${total}`
    try {
      let url = seen.get(s.icon)
      if (url === undefined) {
        const r = await uploadImage(await dataUrlToFile(s.icon, 'icon-' + (s.id || done)))
        url = r.ok && r.url ? r.url : null
        if (url) seen.set(s.icon, url)
      }
      if (url) { s.icon = url; ok++ } else fail++
    } catch { fail++ }
    done++
  }
  if (wallpaper) {
    migrateProgress.value = `${done + 1} / ${total}`
    try {
      const r = await uploadImage(await dataUrlToFile(wallpaper.value, 'wallpaper'))
      if (r.ok && r.url) { cfg.wallpaper = { type: 'url', value: r.url }; ok++ } else fail++
    } catch { fail++ }
    done++
  }
  if (ok) {
    saveConfig()
    window.dispatchEvent(new CustomEvent('apply-background'))
  }
  migrating.value = false
  migrateProgress.value = ''
  showToast(`转存完成：${ok} 项成功${fail ? `，${fail} 项失败（保留内联）` : ''}`)
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

      <!-- 快捷操作：原来右上角那排浮标都搬到这里了，右上角只留一个淡齿轮 -->
      <div class="form-group">
        <label>快捷操作</label>
        <div class="quick-grid">
          <button class="quick-btn" @click="emit('add-site')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>新增站点</span><i>Ctrl+K</i>
          </button>
          <button class="quick-btn" @click="emit('search-sites')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/></svg>
            <span>搜索站点</span><i>Ctrl+F</i>
          </button>
          <button class="quick-btn" @click="emit('builtin-library')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
            <span>内置导航</span><i>按分类挑选</i>
          </button>
          <button class="quick-btn" @click="emit('toggle-theme')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="4"/>
              <line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
              <line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
              <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>
            </svg>
            <span>{{ light ? '切到暗色' : '切到亮色' }}</span><i>当前{{ light ? '亮色' : '暗色' }}</i>
          </button>
          <button class="quick-btn" @click="emit('toggle-view')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
            <span>切换视图</span><i>网格 / 字母</i>
          </button>
        </div>
      </div>

      <!-- 账号：原「用户菜单」的四个动作 -->
      <div class="form-group">
        <label>账号</label>
        <div class="acct-card">
          <div class="acct-mail">{{ authed ? userEmail : '未登录（数据只存在本机）' }}</div>
          <div class="acct-actions">
            <template v-if="authed">
              <button class="btn-text fetch-btn" :disabled="syncing" @click="emit('sync')">{{ syncing ? '同步中…' : '立即同步' }}</button>
              <button class="btn-text fetch-btn" @click="emit('account')">账号管理</button>
              <button v-if="isAdmin" class="btn-text fetch-btn" @click="emit('admin')">用户管理</button>
              <button class="btn-text fetch-btn danger" @click="emit('logout')">退出登录</button>
            </template>
            <button v-else class="btn-text primary" @click="emit('login')">登录 / 注册</button>
          </div>
        </div>
      </div>

      <!-- 大模型 API：配好之后「AI 自动分组」才启用 -->
      <div class="form-group">
        <label>AI 自动分组 <span class="label-hint">（OpenAI 兼容接口，配好才启用）</span></label>
        <div class="ai-form">
          <input class="form-input" v-model="aiForm.apiBase" placeholder="接口地址，如 https://api.deepseek.com/v1" autocomplete="off">
          <input class="form-input" v-model="aiForm.model" placeholder="模型名，如 deepseek-chat" autocomplete="off">
          <input class="form-input" type="password" v-model="aiForm.apiKey" placeholder="API Key（只存本机浏览器）" autocomplete="new-password">
          <div class="ai-row">
            <button class="btn-text fetch-btn" @click="saveAi">保存</button>
            <button class="btn-text primary" :disabled="!aiReady || aiBusy" @click="runAiGroupAll">
              {{ aiBusy ? (aiProgress || '分组中…') : '用 AI 给全部站点分组' }}
            </button>
          </div>
          <p class="ai-tip">
            Key 只保存在本机 localStorage，不入库、不参与偏好同步；调用时经自家 Worker 转发
            （国内浏览器直连大模型接口常超时/CORS 被拦）。分组会覆盖现有分组名。
          </p>
        </div>
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
        <label>时间与名句</label>
        <div class="font-setting">
          <label class="switch-row">
            <span class="switch-label">显示时间</span>
            <input type="checkbox" v-model="heroPrefs.showClock" @change="onHeroChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="switch-row">
            <span class="switch-label">显示农历与节日</span>
            <input type="checkbox" v-model="heroPrefs.showLunar" @change="onHeroChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="switch-row">
            <span class="switch-label">显示名句</span>
            <input type="checkbox" v-model="heroPrefs.showQuote" @change="onHeroChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="slider-row">
            <span>时间字号</span>
            <input type="range" min="28" max="120" step="1" v-model.number="heroPrefs.clockSize" @input="onHeroChange">
            <b>{{ heroPrefs.clockSize }}px</b>
          </label>
          <div class="font-color-row">
            <span class="font-color-label">时间颜色</span>
            <div class="font-swatches">
              <button
                v-for="c in HERO_COLORS"
                :key="c"
                type="button"
                class="font-swatch"
                :class="{ selected: heroPrefs.clockColor === c }"
                :style="{ background: c }"
                :title="c"
                @click="pickClockColor(c)"
              ></button>
              <label class="font-swatch custom" title="自定义颜色">
                <input type="color" :value="customClockColor" @input="e => { heroPrefs.clockColor = e.target.value; customClockColor = e.target.value; onHeroChange() }">
              </label>
              <button v-if="heroPrefs.clockColor" class="font-reset" type="button" @click="pickClockColor('')">恢复渐变</button>
            </div>
          </div>
          <label class="slider-row">
            <span>名句字号</span>
            <input type="range" min="12" max="30" step="1" v-model.number="heroPrefs.quoteSize" @input="onHeroChange">
            <b>{{ heroPrefs.quoteSize }}px</b>
          </label>
          <div class="font-color-row">
            <span class="font-color-label">名句颜色</span>
            <div class="font-swatches">
              <button
                v-for="c in HERO_COLORS"
                :key="'q' + c"
                type="button"
                class="font-swatch"
                :class="{ selected: heroPrefs.quoteColor === c }"
                :style="{ background: c }"
                :title="c"
                @click="pickQuoteColor(c)"
              ></button>
              <label class="font-swatch custom" title="自定义颜色">
                <input type="color" :value="customQuoteColor" @input="e => { heroPrefs.quoteColor = e.target.value; customQuoteColor = e.target.value; onHeroChange() }">
              </label>
              <button v-if="heroPrefs.quoteColor" class="font-reset" type="button" @click="pickQuoteColor('')">重置</button>
            </div>
          </div>
          <p class="settings-hint">名句显示在时间下方；农历行会自动显示节气与传统节日</p>
        </div>
      </div>

      <div class="form-group">
        <label>搜索框</label>
        <div class="font-setting">
          <label class="switch-row">
            <span class="switch-label">隐藏搜索框</span>
            <input type="checkbox" v-model="searchPrefs.hidden" @change="onSearchChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="switch-row">
            <span class="switch-label">显示搜索建议</span>
            <input type="checkbox" v-model="searchPrefs.suggestions" @change="onSearchChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="switch-row">
            <span class="switch-label">保留搜索框内容</span>
            <input type="checkbox" v-model="searchPrefs.keepContent" @change="onSearchChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="switch-row">
            <span class="switch-label">隐藏搜索类别</span>
            <input type="checkbox" v-model="searchPrefs.hideCategory" @change="onSearchChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="switch-row">
            <span class="switch-label">隐藏搜索按钮</span>
            <input type="checkbox" v-model="searchPrefs.hideButton" @change="onSearchChange">
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="slider-row">
            <span>搜索框大小</span>
            <input type="range" min="50" max="150" step="1" v-model.number="searchPrefs.size" @input="onSearchChange">
            <b>{{ searchPrefs.size }}%</b>
          </label>
          <label class="slider-row">
            <span>搜索框圆角</span>
            <input type="range" min="0" max="100" step="1" v-model.number="searchPrefs.radius" @input="onSearchChange">
            <b>{{ searchPrefs.radius }}%</b>
          </label>
          <label class="slider-row">
            <span>搜索框不透明度</span>
            <input type="range" min="30" max="100" step="1" v-model.number="searchPrefs.opacity" @input="onSearchChange">
            <b>{{ searchPrefs.opacity }}%</b>
          </label>
          <p class="settings-hint">圆角 100% 为胶囊形；不透明度越低搜索框越通透</p>
        </div>
      </div>

      <div class="form-group">
        <label>自定义搜索引擎 <span class="label-hint">（搜索链接中用 {q} 表示关键词）</span></label>
        <div class="engine-manager">
          <div v-for="e in customEngines" :key="e.id" class="engine-row">
            <img v-if="e.icon" :src="e.icon" alt="" class="engine-ico" referrerpolicy="no-referrer" @error="e2 => e2.target.style.visibility = 'hidden'">
            <span v-else class="engine-ico fallback">{{ e.name.charAt(0) }}</span>
            <div class="engine-info">
              <div class="engine-name">{{ e.name }}</div>
              <div class="engine-url">{{ e.url }}</div>
            </div>
            <button class="btn-text ghost trash-btn danger" @click="removeEngineFromSettings(e.id)">删除</button>
          </div>
          <div class="engine-add-row">
            <input type="text" class="form-input" v-model="newEngineName" placeholder="名称">
            <input type="text" class="form-input" v-model="newEngineUrl" placeholder="https://www.example.com/search?q={q}" @keydown.enter="addEngineFromSettings">
            <button class="btn-text fetch-btn" @click="addEngineFromSettings">添加</button>
          </div>
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
          <button class="btn-text ghost" :disabled="wpUploading" @click="pickWallpaper">{{ wpUploading ? '上传中…' : '上传图片' }}</button>
          <button class="btn-text ghost" @click="clearWallpaper">清除壁纸</button>
        </div>
        <div v-if="hasWallpaper" class="grid-setting">
          <label class="slider-row">
            <span>模糊度</span>
            <input type="range" min="0" max="30" step="1" v-model.number="wpBlur" @input="previewBlur" @change="saveBlur">
            <b>{{ wpBlur }}px</b>
          </label>
        </div>
        <p class="settings-hint">上传自动压缩至 1440px{{ imgbedEnabled ? '，并转存图床换外链' : '，以 base64 内联保存' }}；启用壁纸后极光背景会淡出</p>
      </div>

      <div v-if="imgbedEnabled && inlineCount" class="form-group">
        <label>图床转存</label>
        <div class="backup-row">
          <button class="btn-text ghost" :disabled="migrating" @click="migrateInlineAssets">
            {{ migrating ? `转存中 ${migrateProgress}…` : `一键转存 ${inlineCount} 项内联资源` }}
          </button>
        </div>
        <p class="settings-hint">把内联（base64）保存的图标{{ inlineAssets.wallpaper ? '与壁纸' : '' }}上传图床替换为外链，配置体积大幅瘦身；失败项自动保留内联</p>
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
