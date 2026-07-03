import { ref } from 'vue'

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
    background: { type: 'color', value: '#181818' },
  }
}

const config = ref(null)
const loading = ref(true)

export function useConfig() {
  async function loadConfig() {
    loading.value = true
    const fallback = getDefaultConfig()
    try {
      const res = await fetch('/api/config')
      console.log('[daohang] API response status:', res.status)
      if (!res.ok) {
        console.error('[daohang] API error, using default config')
        config.value = fallback
        return
      }
      const text = await res.text()
      console.log('[daohang] API raw response:', text.substring(0, 200))
      const data = JSON.parse(text)
      console.log('[daohang] Parsed config, services count:', data?.services?.length)
      config.value = data
    } catch (e) {
      console.error('[daohang] Failed to load config:', e)
      config.value = fallback
    } finally {
      loading.value = false
    }
  }

  async function saveConfig() {
    if (!config.value) return
    try {
      const body = { ...config.value, password: 'mewlxy' }
      await fetch('/api/config', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (e) {
      console.error('Failed to save config:', e)
    }
  }

  return { config, loading, loadConfig, saveConfig }
}
