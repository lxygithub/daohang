<script setup>
import { ref, computed, watch } from 'vue'
import { userEmail, changePassword, deleteAccount } from '../composables/sync'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'deleted'])

// ---- 修改密码 ----
const curPwd = ref('')
const newPwd = ref('')
const newPwd2 = ref('')
const pwdError = ref('')
const pwdBusy = ref(false)
const pwdOk = ref(false)

const newOk = computed(() => newPwd.value.length >= 6)
const canChange = computed(() =>
  curPwd.value && newOk.value && newPwd.value === newPwd2.value && !pwdBusy.value)

async function submitPwd() {
  if (!canChange.value) return
  pwdBusy.value = true
  pwdError.value = ''
  try {
    const r = await changePassword(curPwd.value, newPwd.value)
    if (r.ok) {
      pwdOk.value = true
      curPwd.value = newPwd.value = newPwd2.value = ''
      setTimeout(() => { pwdOk.value = false; emit('close') }, 1600)
    } else {
      pwdError.value = r.error || '修改失败，请稍后再试'
    }
  } finally {
    pwdBusy.value = false
  }
}

// ---- 注销账号 ----
const delPwd = ref('')
const delError = ref('')
const delBusy = ref(false)
const canDelete = computed(() => delPwd.value.length >= 6 && !delBusy.value)

async function submitDelete() {
  if (!canDelete.value) return
  if (!window.confirm('确定要注销账号吗？\n\n云端保存的全部偏好将被永久删除，此操作不可恢复。')) return
  delBusy.value = true
  delError.value = ''
  try {
    const r = await deleteAccount(delPwd.value)
    if (r.ok) {
      emit('deleted')
      emit('close')
    } else {
      delError.value = r.error || '注销失败，请稍后再试'
    }
  } finally {
    delBusy.value = false
  }
}

watch(() => props.visible, v => {
  if (v) {
    curPwd.value = newPwd.value = newPwd2.value = delPwd.value = ''
    pwdError.value = delError.value = ''
    pwdBusy.value = delBusy.value = false
    pwdOk.value = false
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay active" @click.self="emit('close')">
      <div class="modal auth-modal">
        <button class="modal-close" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <h2>账号管理</h2>
        <p class="auth-sub">{{ userEmail }}</p>

        <!-- 修改密码 -->
        <section class="acct-section">
          <h3 class="acct-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            修改密码
          </h3>
          <form class="auth-form" @submit.prevent="submitPwd">
            <div class="form-group">
              <input v-model="curPwd" type="password" class="form-input" autocomplete="current-password" placeholder="当前密码">
            </div>
            <div class="form-group">
              <input v-model="newPwd" type="password" class="form-input" autocomplete="new-password" placeholder="新密码（至少 6 位）">
            </div>
            <div class="form-group">
              <input v-model="newPwd2" type="password" class="form-input" autocomplete="new-password" placeholder="确认新密码">
              <span v-if="newPwd2 && newPwd !== newPwd2" class="auth-field-err">两次输入不一致</span>
            </div>
            <div v-if="pwdError" class="auth-error">{{ pwdError }}</div>
            <button type="submit" class="btn-text primary acct-btn" :disabled="!canChange">
              <span v-if="pwdBusy" class="auth-spinner"></span>
              {{ pwdOk ? '已修改 ✓' : (pwdBusy ? '请稍候…' : '确认修改') }}
            </button>
            <p v-if="pwdOk" class="acct-note ok">密码已更新，其他设备已被退出登录</p>
          </form>
        </section>

        <!-- 注销账号 -->
        <section class="acct-section acct-danger">
          <h3 class="acct-title danger">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
            注销账号
          </h3>
          <p class="acct-warn">
            将永久删除云端保存的服务列表、背景与全部偏好，所有设备立即退出登录，且无法恢复。本机数据会保留。
          </p>
          <form class="auth-form" @submit.prevent="submitDelete">
            <div class="form-group">
              <input v-model="delPwd" type="password" class="form-input" autocomplete="current-password" placeholder="输入当前密码以确认">
            </div>
            <div v-if="delError" class="auth-error">{{ delError }}</div>
            <button type="button" class="btn-text acct-btn danger" :disabled="!canDelete" @click="submitDelete">
              <span v-if="delBusy" class="auth-spinner dark"></span>
              {{ delBusy ? '注销中…' : '永久注销账号' }}
            </button>
          </form>
        </section>
      </div>
    </div>
  </Teleport>
</template>
