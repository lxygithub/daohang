import { ref } from 'vue'
import { useToast } from './useToast'
import { authed, noteConfigSynced } from './sync'

export const AUTH_KEY = 'nav_auth'

export function getStoredPassword() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY)
    return raw ? atob(raw) : ''
  } catch {
    return ''
  }
}

function getDefaultConfig() {
  return {
    services: [
      { id: 'nginx', name: 'Nginx', url: 'https://nginx.ieoc.top', iconType: 'preset', icon: 'server' },
      { id: '1panel', name: '1Panel', url: 'https://1pannel.ieoc.top', iconType: 'preset', icon: 'shield' },
      { id: 'files', name: 'Files', url: 'https://files.ieoc.top', iconType: 'preset', icon: 'folder' },
      { id: 'v2ray', name: 'V2Ray', url: 'https://v2ray.ieoc.top', iconType: 'preset', icon: 'rocket' },
      { id: 'cassos', name: 'Cassos', url: 'https://cassos.ieoc.top', iconType: 'preset', icon: 'code' },
      { id: '163', name: '163', url: 'https://163.ieoc.top', iconType: 'preset', icon: 'mail' },
      { id: 'jenkins', name: 'Jenkins', url: 'https://jenkins.ieoc.top', iconType: 'preset', icon: 'wrench' },
      { id: 'emby', name: 'Emby', url: 'https://emby.ieoc.top', iconType: 'preset', icon: 'play' },
      { id: 'qb', name: 'QB', url: 'https://qb.ieoc.top', iconType: 'preset', icon: 'download' },
      { id: 'alist', name: 'Alist', url: 'https://alist.ieoc.top', iconType: 'preset', icon: 'list' },
      { id: 'halo', name: 'Halo', url: 'https://halo.ieoc.top', iconType: 'preset', icon: 'globe' },
      { id: 'wireguard', name: 'WireGuard', url: 'http://106.75.241.220:51821/', iconType: 'preset', icon: 'lock' },
      { id: 'gh-proxy', name: 'GH-Proxy', url: 'https://gh-proxy.ieoc.top/', iconType: 'preset', icon: 'link' },
    ],
    background: { type: 'color', value: '#0d1017' },
  }
}

const config = ref(null)
const loading = ref(true)

export function useConfig() {
  async function loadConfig() {
    // 已有配置时静默刷新：不翻转 loading，避免 App.vue 的 v-if="loading"
    // 把整个 NavGrid 卸载重挂（登录用户每次刷新 pullAndMerge 都会二次拉取 → 图标闪没再闪回）
    loading.value = config.value === null
    const fallback = getDefaultConfig()
    try {
      const res = await fetch('/api/config')
      if (!res.ok) {
        console.error('[daohang] API error, using default config')
        config.value = fallback
        return
      }
      const text = await res.text()
      const data = JSON.parse(text)
      config.value = data
      // 登录态下记录服务端时间戳，供多设备 LWW 合并
      if (res.headers.get('X-Scope') === 'user') {
        noteConfigSynced(Number(res.headers.get('X-Config-Updated-At')) || 0)
      }
    } catch (e) {
      console.error('[daohang] Failed to load config:', e)
      config.value = fallback
    } finally {
      loading.value = false
    }
  }

  async function saveConfig() {
    if (!config.value) return
    const body = { ...config.value }
    // 登录用户免密保存自己的配置；访客沿用管理密码保存全局配置
    if (!authed.value) {
      const password = getStoredPassword()
      if (!password) {
        useToast().showToast('验证已过期，请重新操作')
        return
      }
      body.password = password
    }
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const d = await res.json().catch(() => ({}))
        if (d.updatedAt) noteConfigSynced(Date.parse(d.updatedAt) || Date.now())
      } else {
        const d = await res.json().catch(() => ({}))
        useToast().showToast('保存失败：' + (d.error || `HTTP ${res.status}`))
      }
    } catch (e) {
      console.error('Failed to save config:', e)
      useToast().showToast('保存失败，请检查网络')
    }
  }

  return { config, loading, loadConfig, saveConfig }
}
