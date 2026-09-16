import { ref } from 'vue'
import { useToast } from './useToast'
import { authed, noteConfigSynced } from './sync'

const config = ref(null)
const loading = ref(true)

export function useConfig() {
  async function loadConfig() {
    // 配置仅属于账号。会话失效时绝不展示或回退到访客配置。
    loading.value = config.value === null
    if (!authed.value) {
      config.value = null
      loading.value = false
      return false
    }
    try {
      const res = await fetch('/api/config')
      if (res.status === 401) {
        authed.value = false
        config.value = null
        return false
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      config.value = JSON.parse(await res.text())
      noteConfigSynced(Number(res.headers.get('X-Config-Updated-At')) || 0)
      return true
    } catch (e) {
      console.error('[daohang] Failed to load config:', e)
      config.value = null
      return false
    } finally {
      loading.value = false
    }
  }

  async function saveConfig() {
    if (!config.value) return false
    if (!authed.value) {
      useToast().showToast('登录已过期，请重新登录')
      return false
    }
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        body: JSON.stringify({ ...config.value }),
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const d = await res.json().catch(() => ({}))
        if (d.updatedAt) noteConfigSynced(Date.parse(d.updatedAt) || Date.now())
        return true
      }
      if (res.status === 401) {
        authed.value = false
        useToast().showToast('登录已过期，请重新登录')
      } else {
        const d = await res.json().catch(() => ({}))
        useToast().showToast('保存失败：' + (d.error || `HTTP ${res.status}`))
      }
    } catch (e) {
      console.error('Failed to save config:', e)
      useToast().showToast('保存失败，请检查网络')
    }
    return false
  }

  return { config, loading, loadConfig, saveConfig }
}
