import { ref } from 'vue'
import { useToast } from './useToast'
import { authed, noteConfigSynced } from './sync'

const config = ref(null)
const loading = ref(true)

// 本地配置缓存：数据在网关后面的家用机上，Worker → 隧道 → 网关单程约 2.5s，
// 启动时还要串行跑「鉴权 → 偏好 → 配置」三次往返（≈7s 白屏转圈）。
// 这里把上次拉到的配置缓存在 localStorage，冷启动时先渲染缓存秒开，随后后台刷新。
// 注意：缓存只在同一浏览器上有效，鉴权失败（换账号/登出）会立即清掉。
const CACHE_KEY = 'nav_config_cache_v1'

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return raw && raw.config ? raw : null
  } catch { return null }
}

function writeCache(cfg, updatedAt) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ config: cfg, updatedAt: updatedAt || Date.now() }))
  } catch {}
}

export function clearConfigCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}

/** 同步执行：有缓存就立刻出页面，返回是否命中 */
export function primeConfigFromCache() {
  if (config.value) return true
  const cached = readCache()
  if (!cached) return false
  config.value = cached.config
  loading.value = false
  return true
}

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
        clearConfigCache()
        return false
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      config.value = JSON.parse(await res.text())
      const updatedAt = Number(res.headers.get('X-Config-Updated-At')) || 0
      noteConfigSynced(updatedAt)
      writeCache(config.value, updatedAt)
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
        if (d.updatedAt) {
          const ts = Date.parse(d.updatedAt) || Date.now()
          noteConfigSynced(ts)
          writeCache(config.value, ts)
        }
        return true
      }
      if (res.status === 401) {
        authed.value = false
        clearConfigCache()
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
