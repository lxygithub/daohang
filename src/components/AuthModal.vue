<script setup>
import { ref, computed, watch } from 'vue'
import { login, register } from '../composables/sync'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'authed'])

const tab = ref('login') // 'login' | 'register'
const email = ref('')
const password = ref('')
const password2 = ref('')
const error = ref('')
const busy = ref(false)

const emailOk = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim()))
const passwordOk = computed(() => password.value.length >= 6)
const canSubmit = computed(() => emailOk.value && passwordOk.value && (tab.value === 'login' || password.value === password2.value) && !busy.value)

watch(() => props.visible, v => {
  if (v) { error.value = ''; busy.value = false }
})

function switchTab(t) {
  tab.value = t
  error.value = ''
}

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  error.value = ''
  try {
    const mail = email.value.trim()
    const r = tab.value === 'login'
      ? await login(mail, password.value)
      : await register(mail, password.value)
    if (r.ok) {
      emit('authed', mail, tab.value)
      emit('close')
    } else {
      error.value = r.error || '操作失败，请稍后再试'
    }
  } catch {
    error.value = '网络异常，请稍后再试'
  } finally {
    busy.value = false
  }
}
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

        <h2>{{ tab === 'login' ? '登录' : '注册' }}</h2>
        <p class="auth-sub">登录后同步你的导航布局、背景与全部偏好设置</p>

        <div class="auth-tabs">
          <button :class="{ active: tab === 'login' }" @click="switchTab('login')">登录</button>
          <button :class="{ active: tab === 'register' }" @click="switchTab('register')">注册</button>
        </div>

        <form class="auth-form" @submit.prevent="submit">
          <div class="form-group">
            <label>邮箱</label>
            <input
              v-model="email" type="email" class="form-input" autocomplete="email"
              placeholder="you@example.com" spellcheck="false"
            >
          </div>
          <div class="form-group">
            <label>密码</label>
            <input
              v-model="password" type="password" class="form-input"
              :autocomplete="tab === 'login' ? 'current-password' : 'new-password'"
              placeholder="至少 6 位"
            >
          </div>
          <div v-if="tab === 'register'" class="form-group">
            <label>确认密码</label>
            <input v-model="password2" type="password" class="form-input" autocomplete="new-password" placeholder="再输入一次">
            <span v-if="password2 && password !== password2" class="auth-field-err">两次输入不一致</span>
          </div>

          <div v-if="error" class="auth-error">{{ error }}</div>

          <button type="submit" class="btn-text primary auth-submit" :disabled="!canSubmit">
            <span v-if="busy" class="auth-spinner"></span>
            {{ busy ? '请稍候…' : (tab === 'login' ? '登录' : '注册并登录') }}
          </button>
        </form>

        <p class="auth-hint">
          邮箱仅作为登录标识，不会发送验证邮件；密码请自行牢记，当前版本暂不支持找回。
        </p>
      </div>
    </div>
  </Teleport>
</template>
