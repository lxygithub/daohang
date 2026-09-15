<script setup>
import { ref, computed, watch } from 'vue'
import { adminListUsers, adminResetPassword, adminDeleteUser } from '../composables/sync'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close'])

const users = ref([])
const loading = ref(false)
const error = ref('')
const notice = ref('')
// 行内展开的密码重置
const resettingId = ref(null)
const resetPwd = ref('')
const busy = ref(false)

const sorted = computed(() => [...users.value].sort((a, b) => (b.isAdmin - a.isAdmin) || (a.id - b.id)))

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const r = await adminListUsers()
    if (r.ok) users.value = r.users
    else error.value = r.error || '加载失败'
  } finally {
    loading.value = false
  }
}

watch(() => props.visible, v => {
  if (v) {
    error.value = notice.value = ''
    resettingId.value = null
    resetPwd.value = ''
    refresh()
  }
})

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
        <p class="auth-sub">共 {{ users.length }} 个账号 · 重置密码会使该用户全部设备下线</p>

        <div v-if="error" class="auth-error">{{ error }}</div>
        <div v-else-if="notice" class="auth-notice">{{ notice }}</div>

        <div class="admin-table" role="table">
          <div class="admin-tr admin-head" role="row">
            <span>用户</span><span>注册</span><span class="num">会话</span><span class="num">偏好</span><span>操作</span>
          </div>

          <div v-if="loading && !users.length" class="admin-empty">加载中…</div>
          <div v-else-if="!users.length" class="admin-empty">暂无用户</div>

          <template v-for="u in sorted" :key="u.id">
            <div class="admin-tr" :class="{ me: u.isAdmin }" role="row">
              <span class="admin-email" :title="u.email">
                {{ u.email }}
                <i v-if="u.isAdmin" class="admin-tag">管理员</i>
              </span>
              <span class="admin-date">{{ fmtDate(u.created_at) }}</span>
              <span class="num">{{ u.sessions }}</span>
              <span class="num">{{ u.prefs }}</span>
              <span class="admin-ops">
                <button class="admin-op" :disabled="busy" @click="startReset(u)">重置密码</button>
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
