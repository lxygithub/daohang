import { ref } from 'vue'
import { useToast } from './useToast'
import { authed, backendDown, noteConfigSynced, timeoutSignal, isTimeout } from './sync'

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
      // 「未登录」有两种，处理必须分开：
      //   * 服务端明确回 401 → 确实没登录，清掉展示（缓存由 401 分支负责清）；
      //   * 后端不可达（网关 530 / 数据库停机）→ 登录态未知，保留已渲染的缓存，
      //     由 App.vue 切到离线只读态。以前这里无条件 config.value = null，
      //     结果服务器一停，缓存明明在也被抹掉、只剩登录框。
      if (!backendDown.value) config.value = null
      loading.value = false
      return false
    }
    let res
    try {
      res = await fetch('/api/config', { signal: timeoutSignal() })
    } catch (e) {
      // 网络层失败/超时：保留缓存（离线只读），不当作未登录。
      // 超时也算「后端不可用」——冷启动那一下能到 20s+，宁可进只读态也别把首屏钉在转圈上。
      backendDown.value = true
      loading.value = false
      if (isTimeout(e)) console.warn('[daohang] 配置请求超时，转为离线只读')
      return false
    }
    try {
      if (res.status === 401) {
        authed.value = false
        config.value = null
        clearConfigCache()
        return false
      }
      if (!res.ok) {
        if (res.status >= 500) backendDown.value = true   // 网关/数据库不可达
        throw new Error(`HTTP ${res.status}`)
      }
      config.value = JSON.parse(await res.text())
      const updatedAt = Number(res.headers.get('X-Config-Updated-At')) || 0
      noteConfigSynced(updatedAt)
      writeCache(config.value, updatedAt)
      backendDown.value = false
      return true
    } catch (e) {
      console.error('[daohang] Failed to load config:', e)
      // 只有「服务端明确拒绝」才清空；下游不可用时留着缓存给只读态渲染
      if (!backendDown.value) config.value = null
      return false
    } finally {
      loading.value = false
    }
  }

  async function saveConfig() {
    if (!config.value) return false
    if (!authed.value) {
      useToast().showToast(backendDown.value ? '数据库服务暂时不可用，暂不能保存（当前为本地缓存只读）' : '登录已过期，请重新登录')
      return false
    }
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        body: JSON.stringify({ ...config.value }),
        headers: { 'Content-Type': 'application/json' },
        signal: timeoutSignal(),
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
      } else if (res.status >= 500) {
        backendDown.value = true
        useToast().showToast('数据库服务暂时不可用，保存失败')
      } else {
        const d = await res.json().catch(() => ({}))
        useToast().showToast('保存失败：' + (d.error || `HTTP ${res.status}`))
      }
    } catch (e) {
      console.error('Failed to save config:', e)
      backendDown.value = true
      useToast().showToast(isTimeout(e) ? '保存超时，请稍后重试' : '保存失败，请检查网络')
    }
    return false
  }

  return { config, loading, loadConfig, saveConfig }
}
