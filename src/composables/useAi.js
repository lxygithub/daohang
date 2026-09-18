// 大模型（OpenAI 兼容接口）设置与「AI 自动分组」调用。
//
// 隐私/安全取舍：API Key **只存在浏览器 localStorage**，不入库、不参与偏好同步；
// 每次调用时随请求体发给自家 Worker，由 Worker 转发给大模型（`/api/ai/group`）。
// 走服务端转发而不是浏览器直连的原因：国内浏览器直连 api.openai.com / api.deepseek.com
// 常常超时或 CORS 被拦，而 Worker 在境外边缘，通道稳定。
import { ref } from 'vue'

const KEY = 'nav_ai_settings'

export const DEFAULT_AI = {
  apiBase: 'https://api.deepseek.com/v1', // OpenAI 兼容接口，含 /v1 前缀
  model: 'deepseek-chat',
  apiKey: '',
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    return raw && typeof raw === 'object' ? { ...DEFAULT_AI, ...raw } : { ...DEFAULT_AI }
  } catch {
    return { ...DEFAULT_AI }
  }
}

export const aiSettings = ref(load())

export function saveAiSettings(next) {
  aiSettings.value = { ...DEFAULT_AI, ...next }
  try { localStorage.setItem(KEY, JSON.stringify(aiSettings.value)) } catch {}
}

/** 配置齐了（有 key + 模型）才算启用；没配置时所有 AI 入口都不显示 */
export function aiConfigured() {
  const s = aiSettings.value
  return Boolean(String(s.apiKey || '').trim() && String(s.model || '').trim() && String(s.apiBase || '').trim())
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
      apiBase: s.apiBase, model: s.model, apiKey: s.apiKey,
      groups: groups || [], items,
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`)
  return d.groups || {}
}
