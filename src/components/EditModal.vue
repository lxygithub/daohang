<script setup>
import { ref, watch, computed, inject } from 'vue'
import ImageCropper from './ImageCropper.vue'
import { probeImageBed, uploadImage } from '../composables/sync'
import { aiConfigured, aiGroupSites } from '../composables/useAi'
import { textIconChars } from '../utils/textIcon'
import {
  normalizeSiteUrl,
  isPrivateHost,
  lanAutoFill,
  mixedContentBlocked,
  guessLanName,
} from '../utils/siteMeta'

const props = defineProps({
  visible: Boolean,
  services: { type: Array, required: true },
  editIndex: { type: Number, default: -1 },
})

const emit = defineEmits(['close', 'saved'])
const ensureVerified = inject('ensureVerified')
const showToast = inject('showToast')

const name = ref('')
const url = ref('')
const group = ref('')
const iconUrl = ref('')
const faviconPreview = ref('')
const fetchingFavicon = ref(false)
const cropFile = ref(null)
const showCropper = ref(false)
// 自建图床：已配置时上传图标自动转外链；未配置/失败回退 base64 内联（原行为）
const imgbedEnabled = ref(false)
const uploadingIcon = ref(false)
const nameTouched = ref(false)
// 自动获取失败（没拿到图标）时，才把「重试获取」按钮亮出来——正常流程是全自动的
const fetchFailed = ref(false)
// 防抖等待期也算"在识别"：粘完链接到真正发请求之间有 800ms，这段时间没反馈会让人以为卡了
const fetchPending = ref(false)
const aiGrouping = ref(false)
const aiGroupHint = ref('')
const groupTouched = ref(false)
let autoFetchTimer = null
let skipAutoUrl = ''
let lastNameAuto = ''

// ---- 模糊搜索建议（关键词 → 站点库命中 + 猜出来的域名）----
const suggestOpen = ref(false)
const suggestLoading = ref(false)
const suggestItems = ref([])
const suggestDomains = ref([])
const suggestIndex = ref(-1)
let suggestTimer = null
let suggestSeq = 0

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
const suggestTotal = computed(() => suggestItems.value.length + suggestDomains.value.length)

// 什么算「关键词」：不含点和斜杠的短输入（taobao、知乎、chatgpt）。带点的当域名走自动获取。
function looksLikeKeyword(v) {
  const s = v.trim()
  return s.length > 0 && s.length <= 40 && !/[./\\:]/.test(s)
}

async function loadSuggestions(kw) {
  const my = ++suggestSeq
  suggestLoading.value = true
  suggestOpen.value = true
  try {
    const res = await fetch(`/api/site-suggest?q=${encodeURIComponent(kw)}`)
    const d = await res.json()
    if (my !== suggestSeq) return // 已被更新的输入取代
    suggestItems.value = d.library || []
    suggestDomains.value = d.domains || []
    suggestIndex.value = suggestTotal.value ? 0 : -1
  } catch {
    if (my === suggestSeq) { suggestItems.value = []; suggestDomains.value = [] }
  } finally {
    if (my === suggestSeq) suggestLoading.value = false
  }
}

function closeSuggest() {
  suggestOpen.value = false
  suggestIndex.value = -1
}

// 失焦后稍等再关：留出点击下拉项的时间（下拉项自己也用了 mousedown.prevent）
function closeSuggestSoon() {
  setTimeout(() => { suggestOpen.value = false }, 180)
}

function pickSuggestItem(it) {
  closeSuggest()
  applyPick({
    name: it.name,
    url: it.url,
    icon: it.icon || '',
    description: it.description || '',
    suggestedGroup: '',
  })
}

function pickSuggestDomain(d) {
  closeSuggest()
  url.value = d
  autoFetch(false) // 立刻去取标题（抓不到会用域名预填）和图标
}

function pickActiveSuggest() {
  if (suggestIndex.value < 0) return
  const i = suggestIndex.value
  if (i < suggestItems.value.length) pickSuggestItem(suggestItems.value[i])
  else pickSuggestDomain(suggestDomains.value[i - suggestItems.value.length])
}

function onUrlKeydown(e) {
  if (!suggestOpen.value || !suggestTotal.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    suggestIndex.value = (suggestIndex.value + 1) % suggestTotal.value
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    suggestIndex.value = (suggestIndex.value - 1 + suggestTotal.value) % suggestTotal.value
  } else if (e.key === 'Enter' && suggestIndex.value >= 0) {
    e.preventDefault()
    pickActiveSuggest()
  } else if (e.key === 'Escape') {
    closeSuggest()
  }
}

const isEditing = computed(() => props.editIndex >= 0)
const modalTitle = computed(() => isEditing.value ? '编辑站点' : '新增站点')

// 分组选项（去重）
const groupOptions = computed(() => {
  const set = new Set()
  for (const s of props.services) {
    const g = (s.group || '').trim()
    if (g) set.add(g)
  }
  return [...set]
})

watch(() => props.visible, (val) => {
  if (!val) return
  faviconPreview.value = ''
  probeImageBed().then(v => { imgbedEnabled.value = v })
  nameTouched.value = false
  lastNameAuto = ''
  clearTimeout(autoFetchTimer)
  fetchFailed.value = false
  aiGroupHint.value = ''
  aiGrouping.value = false
  groupTouched.value = false
  closeSuggest()
  if (props.editIndex >= 0) {
    const svc = props.services[props.editIndex]
    if (svc) {
      name.value = svc.name
      url.value = svc.url
      skipAutoUrl = svc.url
      group.value = svc.group || ''
      iconUrl.value = svc.iconType === 'url' ? svc.icon : ''
      if (iconUrl.value) faviconPreview.value = iconUrl.value
    }
  } else {
    name.value = ''
    url.value = ''
    skipAutoUrl = ''
    group.value = ''
    // 必须一并清掉上个站点遗留的图标：否则连续新增时，第二个站点若解析
    // 不到图标，会沿用上一个站点解析成功的图标（实际线上 bug）
    iconUrl.value = ''
  }
})

// 输入链接后自动获取标题 + 图标（防抖，静默）
watch(url, (val) => {
  clearTimeout(suggestTimer)
  fetchFailed.value = false // 换了链接就收起「重试获取」，等新一轮自动获取的结果
  fetchPending.value = false
  if (val.trim() === skipAutoUrl) return
  clearTimeout(autoFetchTimer)
  const u = val.trim()
  if (!u) { closeSuggest(); return }
  // 关键词（taobao / 知乎）→ 联想搜索；不拿 https://taobao 去白跑一趟自动获取
  if (looksLikeKeyword(u)) {
    suggestTimer = setTimeout(() => loadSuggestions(u), 300)
    return
  }
  closeSuggest()
  const host = parseDomain(u)
  if (!host) return
  // 只像「完整域名」时才自动抓取：带点（含 IP）或带端口（内网 nas:5000）
  const looksLikeHost = host.includes('.') || /:\d+\/?$/.test(u)
  if (!looksLikeHost) return
  fetchPending.value = true
  autoFetchTimer = setTimeout(() => autoFetch(true), 800)
})

function parseDomain(u) {
  try {
    const d = new URL(u.includes('://') ? u : 'https://' + u)
    return d.hostname
  } catch { return '' }
}

async function fetchFavicon() {
  return autoFetch(false)
}

// 自动获取：标题 + 图标一次拿齐（silent=true 时由防抖触发，不弹提示）
// - 内网地址：Cloudflare 边缘无法访问 → 浏览器直连探测（lanAutoFill）
// - 公网地址：全部交给 /api/meta（Worker 侧：内置站点库 → 站点自身 → 多个公共图标服务 → 转存图床）。
//   浏览器端不再发起任何公网图标请求：用户在国内直连那些服务/站点会被墙，而且拿到的是
//   目标站自己的链接（站点被墙时首页就是破图），不如统一由 Worker 取回并转存到自家图床。
async function autoFetch(silent = false) {
  const normalized = normalizeSiteUrl(url.value.trim())
  if (!normalized) {
    if (!silent) showToast('请先填写正确的链接')
    return
  }
  fetchingFavicon.value = true
  fetchPending.value = false
  // 陈旧响应守卫：请求期间用户若改了链接，晚到的响应不得覆盖当前内容
  const forUrl = normalized
  const stale = () => normalizeSiteUrl(url.value.trim()) !== forUrl
  let lan = false
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    let data
    lan = isPrivateHost(new URL(normalized).hostname)
    if (lan) {
      data = await lanAutoFill(normalized)
      // 内网页面标题受 CORS 限制通常读不到：按端口推测服务名（群晖/Jellyfin/HA 等），
      // 推测不出用地址兑底，避免名称栏空着（均可改）
      if (!data.title) {
        data.title = guessLanName(normalized)
        data.titleGuessed = !!data.title
      }
    } else {
      const res = await fetch(`/api/meta?url=${encodeURIComponent(normalized)}`, { signal: ctrl.signal })
      data = await res.json()
      // 标题抓不到（整站反爬，如 chatgpt.com）时用域名预填，别让名称栏空着——和下面
      // 内网那条路径一样的套路，用户可改。
      if (!data.title) {
        data.title = new URL(normalized).hostname.replace(/^www\./, '')
        data.titleGuessed = true
      }
    }
    clearTimeout(timer)

    // 链接已变：本次结果作废，避免旧站点的标题/图标串到新站点上
    if (stale()) return
    let got = false
    if (data.title && (!name.value.trim() || name.value === lastNameAuto)) {
      name.value = data.title
      lastNameAuto = data.title
      got = true
    }
    if (data.icon) {
      iconUrl.value = data.icon
      faviconPreview.value = data.icon
      got = true
    }
    // 有图标就算成功；没图标才需要用户点「重试获取」
    fetchFailed.value = !data.icon
    if (!silent) {
      if (got && data.titleGuessed) {
        showToast(lan
          ? '图标已获取；内网页面读不到标题（浏览器安全策略），名称已按地址预填，可修改'
          : '图标已获取；页面标题抓不到（站点反爬），名称已按域名预填，可修改')
      }
      else if (got) showToast(lan ? '已自动填充（浏览器直连）' : '已自动填充')
      else if (lan && mixedContentBlocked(normalized)) showToast('HTTPS 页面无法读取 HTTP 内网资源（浏览器拦截），建议手动上传图标')
      else if (data.error) showToast(`未能获取（${data.error}），可手动填写`)
      else showToast('未能获取，可手动填写')
    }
    // 配了大模型就顺手让它认一下分组（结果填进输入框，用户可改）
    if (!stale()) autoAssignGroup()
  } catch (e) {
    fetchFailed.value = true
    if (!silent) showToast('获取失败：' + (e?.message || '请手动填写'))
  } finally {
    fetchingFavicon.value = false
    fetchPending.value = false
  }
}

function pickFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    if (input.files?.length) {
      cropFile.value = input.files[0]
      showCropper.value = true
    }
  }
  input.click()
}

async function onCropDone(dataUrl) {
  showCropper.value = false
  cropFile.value = null
  // 未配置图床：沿用内联 base64（原行为，无需登录）
  if (!imgbedEnabled.value) {
    iconUrl.value = dataUrl
    faviconPreview.value = dataUrl
    return
  }
  // 已配置图床：上传换外链，失败回退内联，绝不阻断保存
  uploadingIcon.value = true
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], 'icon.png', { type: blob.type || 'image/png' })
    const r = await uploadImage(file)
    if (r.ok && r.url) {
      iconUrl.value = r.url
      faviconPreview.value = r.url
      showToast('图标已上传图床')
    } else {
      iconUrl.value = dataUrl
      faviconPreview.value = dataUrl
      showToast((r.error || '图床上传失败') + '，已改用内联保存')
    }
  } catch {
    iconUrl.value = dataUrl
    faviconPreview.value = dataUrl
    showToast('图床上传失败，已改用内联保存')
  } finally {
    uploadingIcon.value = false
  }
}

function onCropCancel() {
  showCropper.value = false
  cropFile.value = null
}

function save() {
  const n = name.value.trim()
  // 保存时规范化：裸地址补协议（内网 http://，公网 https://），保证卡片链接可点开
  const rawUrl = url.value.trim()
  const u = normalizeSiteUrl(rawUrl) || rawUrl
  const iu = iconUrl.value.trim()

  if (!n || !u) {
    showToast('请填写名称和链接')
    return
  }

  const svc = {
    id: 'svc-' + Date.now(),
    name: n,
    url: u,
  }
  const g = group.value.trim()
  if (g) svc.group = g

  if (iu) {
    // 自动获取或用户上传的图标
    svc.iconType = 'url'
    svc.icon = iu
  }
  // 没有图标 → 不写入图标字段，列表以纯色背景文字图标展示

  ensureVerified(() => {
    if (props.editIndex >= 0) {
      svc.id = props.services[props.editIndex].id
      props.services[props.editIndex] = svc
      showToast('已更新')
    } else {
      props.services.push(svc)
      showToast('已添加')
    }
    emit('saved')
    emit('close')
  })
}

// 选中候选（站点库命中）：回填名称/链接/图标，不再触发自动获取
function applyPick(site) {
  url.value = site.url
  skipAutoUrl = site.url
  name.value = site.name
  lastNameAuto = site.name
  nameTouched.value = true
  if (site.icon) {
    iconUrl.value = site.icon
    faviconPreview.value = site.icon
  } else {
    iconUrl.value = ''
    faviconPreview.value = ''
  }
  if (!group.value.trim() && site.suggestedGroup) group.value = site.suggestedGroup
  fetchFailed.value = false
  showToast('已填入，可修改后保存')
  autoAssignGroup()
}

// ---- AI 自动分组（单站点）----
// 配了大模型就自动跑：抓完标题/图标后，把模型给的分组名填进输入框（用户可改）。
// 用户手动改过分组（groupTouched）或已经有值时不再覆盖。
async function autoAssignGroup() {
  if (aiGrouping.value || !aiConfigured()) return
  if (groupTouched.value || group.value.trim()) return
  const siteName = name.value.trim()
  if (!siteName) return
  aiGrouping.value = true
  aiGroupHint.value = ''
  try {
    const picked = await aiGroupSites(
      [{ id: 'this', name: siteName, url: url.value.trim() }],
      groupOptions.value,
    )
    const g = picked.this
    // 用户可能在等待期间自己填了分组 → 别覆盖
    if (g && !groupTouched.value && !group.value.trim()) {
      group.value = g
      aiGroupHint.value = `AI 分组：${g}（可改）`
    } else if (!g) {
      aiGroupHint.value = 'AI 没能给出分组，可手填'
    }
  } catch (e) {
    aiGroupHint.value = 'AI 分组失败，可手填'
  } finally {
    aiGrouping.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" :class="{ active: visible }">
    <!-- 闭包控制：仅右上角 × / 取消 / 保存可关闭，点击遮罩空白处不关闭（用户要求） -->
    <div class="modal modal-lg">
      <div class="modal-header">
        <h2>{{ modalTitle }}</h2>
        <button class="modal-close" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="form-group">
        <label>链接 <span class="label-hint">（粘贴链接自动识别，或输入关键词搜索）</span></label>
        <div class="input-row">
          <div class="url-field">
            <input
              type="text" class="form-input" v-model="url"
              placeholder="粘贴链接，或搜关键词，如 github / 知乎"
              autocomplete="off"
              @keydown="onUrlKeydown"
              @blur="closeSuggestSoon"
            >
            <!-- 模糊搜索联想：站点库命中在前，其次是 DoH 猜出来的域名 -->
            <div v-if="suggestOpen && (suggestLoading || suggestTotal)" class="suggest-pop">
              <div v-if="suggestLoading" class="suggest-tip">搜索中…</div>
              <template v-else>
                <button
                  v-for="(it, i) in suggestItems" :key="'lib' + it.id"
                  type="button" class="suggest-row" :class="{ on: suggestIndex === i }"
                  :title="`${it.name} · ${hostOf(it.url)}`"
                  @mousedown.prevent="pickSuggestItem(it)"
                >
                  <img
                    v-if="it.icon" :src="it.icon" class="suggest-icon" loading="lazy"
                    referrerpolicy="no-referrer"
                    @error="$event.target.style.display = 'none'"
                  >
                  <span v-else class="suggest-icon suggest-icon-ph">{{ textIconChars(it.name) }}</span>
                  <span class="suggest-name">{{ it.name }}</span>
                  <span class="suggest-host">{{ hostOf(it.url) }}</span>
                </button>
                <div v-if="suggestDomains.length" class="suggest-sep">
                  可能是这些站点{{ suggestItems.length ? '' : '（点一下获取标题和图标）' }}
                </div>
                <button
                  v-for="(d, j) in suggestDomains" :key="d"
                  type="button" class="suggest-row" :class="{ on: suggestIndex === suggestItems.length + j }"
                  :title="`${d} · 点击后自动获取标题和图标`"
                  @mousedown.prevent="pickSuggestDomain(d)"
                >
                  <span class="suggest-icon suggest-icon-ph">🌐</span>
                  <span class="suggest-name suggest-domain">{{ d }}</span>
                </button>
              </template>
            </div>
          </div>
          <!-- 正常流程是全自动的：只有自动获取没拿到图标时才需要这张按钮 -->
          <button
            v-if="fetchFailed"
            class="btn-text fetch-btn"
            :class="{ loading: fetchingFavicon }"
            @click="autoFetch(false)"
            :disabled="fetchingFavicon"
          >{{ fetchingFavicon ? '获取中…' : '重试获取' }}</button>
        </div>
        <!-- 识别中要有动静，否则用户以为界面卡住了 -->
        <p v-if="fetchingFavicon || fetchPending" class="fetch-status">
          <span class="mini-spinner" aria-hidden="true"></span>
          正在识别标题和图标…
        </p>
      </div>
      <div class="form-group">
        <label>名称</label>
        <input type="text" class="form-input" v-model="name" placeholder="站点名称" @input="nameTouched = true">
      </div>
      <div class="form-group">
        <label>分组 <span class="label-hint">（可选，同组站点归类显示）</span></label>
        <div class="input-row">
          <input
            type="text"
            class="form-input"
            v-model="group"
            list="group-options"
            placeholder="如：开发工具 / 媒体 / 网络"
            @input="groupTouched = true"
          >
        </div>
        <p v-if="aiGrouping || aiGroupHint" class="group-hint">
          <span v-if="aiGrouping" class="mini-spinner" aria-hidden="true"></span>
          {{ aiGrouping ? 'AI 正在识别分组…' : aiGroupHint }}
        </p>
        <datalist id="group-options">
          <option v-for="g in groupOptions" :key="g" :value="g" />
        </datalist>
      </div>
      <div class="form-group">
        <label>图标 <span class="label-hint">（未选择时显示纯色背景文字图标）</span></label>
        <div class="custom-icon-panel">
          <button class="btn-text upload-btn" @click="pickFile">上传图标</button>
          <input type="text" class="form-input" v-model="iconUrl" placeholder="或输入图片 URL">
          <img v-if="faviconPreview" :src="faviconPreview" class="favicon-preview" referrerpolicy="no-referrer" @error="faviconPreview = ''">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-text cancel" @click="emit('close')">取消</button>
        <button class="btn-text primary" @click="save">保存</button>
      </div>
    </div>
  </div>

  <ImageCropper
    v-if="showCropper && cropFile"
    :file="cropFile"
    @crop="onCropDone"
    @cancel="onCropCancel"
  />

</template>

<style scoped>
/* 关键词联想下拉：贴在链接输入框下方 */
.url-field { position: relative; flex: 1; }
.url-field .form-input { width: 100%; }

.suggest-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 40;
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: var(--shadow-pop);
}

.suggest-tip { padding: 10px 12px; font-size: 13px; color: var(--text-3); }

.suggest-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}
.suggest-row:hover, .suggest-row.on { background: var(--surface-hover); }

.suggest-icon {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 6px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.06);
}
.suggest-icon-ph {
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.suggest-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 域名候选行：整条就是一个域名，别截断，让用户看清是 .com 还是 .cn */
.suggest-domain { overflow: visible; text-overflow: clip; font-weight: 500; }
.suggest-host { flex: none; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-3); }

.suggest-sep {
  margin: 6px 9px 2px;
  font-size: 11.5px;
  color: var(--text-3);
}

/* 分组输入框下方的 AI 提示 */
.group-hint {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-3);
}

/* 识别中：小转圈 + 文案 */
.fetch-status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-2);
}
.mini-spinner {
  width: 13px;
  height: 13px;
  flex: none;
  border-radius: 50%;
  border: 2px solid rgba(128, 140, 170, 0.25);
  border-top-color: var(--accent);
  animation: modal-mini-spin 0.7s linear infinite;
}
@keyframes modal-mini-spin { to { transform: rotate(360deg); } }
</style>
