// 大模型（OpenAI 兼容接口）设置与「AI 自动分组」调用。
//
// 隐私/安全取舍：API Key **只存在浏览器 localStorage**，不入库、不参与偏好同步；
// 每次调用时随请求体发给自家 Worker，由 Worker 转发给大模型（`/api/ai/group`）。
// 走服务端转发而不是浏览器直连的原因：国内浏览器直连 api.openai.com / api.deepseek.com
// 常常超时或 CORS 被拦，而 Worker 在境外边缘，通道稳定。
//
// 2026-09-18 变更（两轮）：
//   1) 设置跟账号同步（接口地址/模型走 /api/user/prefs 的 LWW 合并，key = 'ai'）；
//   2) **Key 只写不读**：单独存服务端 user_data.key = 'ai_key'，任何接口都不回传，
//      浏览器 localStorage 里也不留 —— 控制台/扩展/XSS 都读不到。
//      页面只知道一个 hasKey 标记；真正调用时由 Worker 去库里取 Key（见 api/ai/group.js）。
import { ref } from 'vue'

const KEY = 'nav_ai_settings'

export const DEFAULT_AI = {
  apiBase: 'https://api.deepseek.com/v1', // OpenAI 兼容接口，含 /v1 前缀
  model: 'deepseek-chat',
  hasKey: false, // 服务端是否已保存 Key（前端拿不到 Key 本身）
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_AI }
    // 老数据里可能还带着 apiKey：立刻从本地抹掉（服务器那份由 prefs 接口搬到 ai_key）
    if ('apiKey' in raw) {
      delete raw.apiKey
      try { localStorage.setItem(KEY, JSON.stringify(raw)) } catch {}
    }
    return { ...DEFAULT_AI, ...raw }
  } catch {
    return { ...DEFAULT_AI }
  }
}

export const aiSettings = ref(load())

function normalize(o) {
  const src = o && typeof o === 'object' ? { ...o } : {}
  delete src.apiKey // 任何情况下都不在本地保存 Key
  return { ...DEFAULT_AI, ...src }
}

/** 写 localStorage + 广播事件；同步层（bindPrefEvents）监听到就会推到账号上 */
export function saveAiSettings(next) {
  const merged = normalize(next)
  aiSettings.value = merged
  try { localStorage.setItem(KEY, JSON.stringify(merged)) } catch {}
  window.dispatchEvent(new CustomEvent('ai-changed', { detail: merged }))
}

/** 保存 Key：只上行一次，服务端不回传；成功后本地只留 hasKey 标记 */
export async function saveAiKey(apiKey) {
  const res = await fetch('/api/settings/ai-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: String(apiKey || '').trim() }),
    signal: AbortSignal.timeout(20000),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`)
  aiSettings.value = { ...aiSettings.value, hasKey: !!d.hasKey }
  try { localStorage.setItem(KEY, JSON.stringify(aiSettings.value)) } catch {}
  return !!d.hasKey
}

// 服务端把值写回 localStorage 后也会广播同一个事件（见 sync.js 的 applyServer）
if (typeof window !== 'undefined') {
  window.addEventListener('ai-changed', (e) => {
    const d = e?.detail
    aiSettings.value = d && typeof d === 'object' ? normalize(d) : load()
  })
}

/** 配置齐了（有 key + 模型）才算启用；没配置时所有 AI 入口都不显示 */
export function aiConfigured() {
  const s = aiSettings.value
  return Boolean(s.hasKey && String(s.model || '').trim() && String(s.apiBase || '').trim())
}

/**
 * 让大模型给这批站点分组。
 * @param {Array<{id:string,name:string,url:string}>} items
 * @param {string[]} groups 已有分组名，作为优先选项
 * @returns {Promise<Record<string,string>>} 站点 id → 分组名
 */
export async function aiGroupSites(items, groups) {
  const s = aiSettings.value
  const res = await fetch('/api/ai/group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // 不带 apiKey：Worker 用当前会话去库里取
      apiBase: s.apiBase, model: s.model,
      groups: groups || [], items,
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`)
  return d.groups || {}
}
