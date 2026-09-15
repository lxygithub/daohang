<script setup>
import { ref, computed, watch } from 'vue'
import { adminListUsers, adminResetPassword, adminDeleteUser, adminSetDisabled } from '../composables/sync'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close'])

const users = ref([])
const loading = ref(false)
const error = ref('')
const notice = ref('')
// 搜索（邮箱子串，300ms 防抖；seq 防止乱序响应覆盖新结果）
const q = ref('')
let qTimer = null
let seq = 0
// 行内展开的密码重置
const resettingId = ref(null)
const resetPwd = ref('')
const busy = ref(false)

const sorted = computed(() => [...users.value].sort((a, b) => (b.isAdmin - a.isAdmin) || (a.id - b.id)))

async function refresh() {
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await adminListUsers(q.value.trim())
    if (my !== seq) return // 已有更新的请求在途，丢弃过期结果
    if (r.ok) users.value = r.users
    else error.value = r.error || '加载失败'
  } finally {
    if (my === seq) loading.value = false
  }
}

watch(q, () => {
  clearTimeout(qTimer)
  qTimer = setTimeout(() => { if (props.visible) refresh() }, 300)
})

watch(() => props.visible, v => {
  if (v) {
    error.value = notice.value = ''
    resettingId.value = null
    resetPwd.value = ''
    q.value = '' // 重新打开时重置搜索，展示全量
    refresh()
  }
})

function clearSearch() {
  q.value = ''
}

function startReset(u) {
  resettingId.value = u.id
  resetPwd.value = ''
  error.value = notice.value = ''
}

function cancelReset() {
  resettingId.value = null
  resetPwd.value = ''
}

async function confirmReset(u) {
  if (resetPwd.value.length < 6 || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await adminResetPassword(u.id, resetPwd.value)
    if (r.ok) {
      notice.value = r.data?.message || `已重置 ${u.email} 的密码`
      cancelReset()
      refresh()
    } else {
      error.value = r.error || '重置失败'
    }
  } finally {
    busy.value = false
  }
}

async function removeUser(u) {
  if (busy.value) return
  if (!window.confirm(`确定删除用户 ${u.email} 吗？\n\n其云端偏好将永久清除，所有设备立即下线，此操作不可恢复。`)) return
  busy.value = true
  error.value = ''
  try {
    const r = await adminDeleteUser(u.id)
    if (r.ok) {
      notice.value = r.data?.message || `已删除 ${u.email}`
      refresh()
    } else {
      error.value = r.error || '删除失败'
    }
  } finally {
    busy.value = false
  }
}

async function toggleDisable(u) {
  if (busy.value || u.isAdmin) return
  const next = u.disabled ? 0 : 1
  if (next === 1 && !window.confirm(`确定禁用 ${u.email} 吗？\n\n该用户将立即下线且无法登录，云端数据保留，可随时启用。`)) return
  busy.value = true
  error.value = ''
  try {
    const r = await adminSetDisabled(u.id, next)
    if (r.ok) {
      notice.value = r.data?.message || (next ? '已禁用' : '已启用')
      refresh()
    } else {
      error.value = r.error || '操作失败'
    }
  } finally {
    busy.value = false
  }
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) }
  catch { return iso || '—' }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay active" @click.self="emit('close')">
      <div class="modal auth-modal admin-modal">
        <button class="modal-close" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <h2>用户管理</h2>
        <p class="auth-sub">{{ q.trim() ? `匹配 ${users.length} 个账号` : `共 ${users.length} 个账号` }} · 禁用后该用户全端下线且无法登录，数据保留</p>

        <div class="admin-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="q" type="text" class="form-input"
            placeholder="搜索邮箱…"
            autocomplete="off" spellcheck="false"
          >
          <button v-if="q" class="admin-search-clear" title="清空" @click="clearSearch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div v-if="error" class="auth-error">{{ error }}</div>
        <div v-else-if="notice" class="auth-notice">{{ notice }}</div>

        <div class="admin-table" role="table">
          <div class="admin-tr admin-head" role="row">
            <span>用户</span><span>注册</span><span class="num">会话</span><span class="num">偏好</span><span>操作</span>
          </div>

          <div v-if="loading && !users.length" class="admin-empty">加载中…</div>
          <div v-else-if="!users.length" class="admin-empty">{{ q.trim() ? '没有匹配的用户' : '暂无用户' }}</div>

          <template v-for="u in sorted" :key="u.id">
            <div class="admin-tr" :class="{ me: u.isAdmin, 'is-disabled': u.disabled }" role="row">
              <span class="admin-email" :title="u.email">
                {{ u.email }}
                <i v-if="u.isAdmin" class="admin-tag">管理员</i>
                <i v-if="u.disabled" class="admin-tag off">已禁用</i>
              </span>
              <span class="admin-date">{{ fmtDate(u.created_at) }}</span>
              <span class="num">{{ u.sessions }}</span>
              <span class="num">{{ u.prefs }}</span>
              <span class="admin-ops">
                <button class="admin-op" :disabled="busy" @click="startReset(u)">重置密码</button>
                <button
                  class="admin-op warn" :disabled="busy || u.isAdmin"
                  :title="u.isAdmin ? '管理员不可被禁用' : (u.disabled ? '解除禁用，允许登录' : '禁止登录，全端下线')"
                  @click="toggleDisable(u)"
                >{{ u.disabled ? '启用' : '禁用' }}</button>
                <button class="admin-op danger" :disabled="busy || u.isAdmin" :title="u.isAdmin ? '管理员不可删除' : ''" @click="removeUser(u)">删除</button>
              </span>
            </div>
            <div v-if="resettingId === u.id" class="admin-reset-row">
              <input
                v-model="resetPwd" type="text" class="form-input"
                :placeholder="`为 ${u.email} 设置新密码（至少 6 位）`"
                autocomplete="off" spellcheck="false"
                @keyup.enter="confirmReset(u)"
              >
              <button class="admin-op primary" :disabled="resetPwd.length < 6 || busy" @click="confirmReset(u)">确认</button>
              <button class="admin-op" :disabled="busy" @click="cancelReset">取消</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
