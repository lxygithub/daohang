<script setup>
import { ref, computed, watch } from 'vue'
import { login, register, forgotPassword, resetPassword } from '../composables/sync'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'authed'])

const tab = ref('login') // 'login' | 'register' | 'forgot'
const email = ref('')
const password = ref('')
const password2 = ref('')
const error = ref('')
const notice = ref('')
const busy = ref(false)

// 找回密码两步流程
const fStep = ref(1) // 1 = 输入邮箱；2 = 验证码 + 新密码
const fEmail = ref('')
const fCode = ref('')
const fPwd = ref('')
const fPwd2 = ref('')

const emailOk = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim()))
const passwordOk = computed(() => password.value.length >= 6)
const canSubmit = computed(() => emailOk.value && passwordOk.value && (tab.value === 'login' || password.value === password2.value) && !busy.value)

const fEmailOk = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fEmail.value.trim()))
const fCanSend = computed(() => fEmailOk.value && !busy.value)
const fNewOk = computed(() => fPwd.value.length >= 6)
const fCanReset = computed(() => fEmailOk.value && fCode.value.trim().length > 0 && fNewOk.value && fPwd.value === fPwd2.value && !busy.value)

watch(() => props.visible, v => {
  if (v) { error.value = ''; notice.value = ''; busy.value = false }
})

function switchTab(t) {
  tab.value = t
  error.value = ''
  notice.value = ''
  if (t === 'forgot') fStep.value = 1
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

async function sendCode() {
  if (!fCanSend.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await forgotPassword(fEmail.value.trim())
    if (r.ok) {
      fStep.value = 2
      notice.value = r.message || '验证码已发出，请查收邮件'
    } else {
      error.value = r.error || '发送失败，请稍后再试'
    }
  } finally {
    busy.value = false
  }
}

async function doReset() {
  if (!fCanReset.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await resetPassword(fEmail.value.trim(), fCode.value.trim(), fPwd.value)
    if (r.ok) {
      // 重置成功 → 回到登录页，带上邮箱方便直接登录
      email.value = fEmail.value.trim()
      password.value = ''
      password2.value = ''
      fEmail.value = fCode.value = fPwd.value = fPwd2.value = ''
      fStep.value = 1
      tab.value = 'login'
      notice.value = '密码已重置，请使用新密码登录'
    } else {
      error.value = r.error || '重置失败，请稍后再试'
    }
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

        <h2>{{ tab === 'login' ? '登录' : tab === 'register' ? '注册' : '找回密码' }}</h2>
        <p class="auth-sub">{{ tab === 'forgot' ? '通过注册邮箱验证码重置密码' : '登录后同步你的导航布局、背景与全部偏好设置' }}</p>

        <div v-if="tab !== 'forgot'" class="auth-tabs">
          <button :class="{ active: tab === 'login' }" @click="switchTab('login')">登录</button>
          <button :class="{ active: tab === 'register' }" @click="switchTab('register')">注册</button>
        </div>

        <!-- 登录 / 注册 -->
        <form v-if="tab !== 'forgot'" class="auth-form" @submit.prevent="submit">
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
          <div v-else-if="notice" class="auth-notice">{{ notice }}</div>

          <button type="submit" class="btn-text primary auth-submit" :disabled="!canSubmit">
            <span v-if="busy" class="auth-spinner"></span>
            {{ busy ? '请稍候…' : (tab === 'login' ? '登录' : '注册并登录') }}
          </button>
          <button v-if="tab === 'login'" type="button" class="auth-link" @click="switchTab('forgot')">
            忘记密码？
          </button>
        </form>

        <!-- 找回密码 -->
        <form v-else class="auth-form" @submit.prevent="fStep === 1 ? sendCode() : doReset()">
          <template v-if="fStep === 1">
            <div class="form-group">
              <label>注册邮箱</label>
              <input v-model="fEmail" type="email" class="form-input" autocomplete="email" placeholder="you@example.com" spellcheck="false">
            </div>
            <div v-if="error" class="auth-error">{{ error }}</div>
            <button type="submit" class="btn-text primary auth-submit" :disabled="!fCanSend">
              <span v-if="busy" class="auth-spinner"></span>
              {{ busy ? '发送中…' : '发送验证码' }}
            </button>
          </template>
          <template v-else>
            <div class="form-group">
              <label>验证码 <span class="auth-dim">已发送至 {{ fEmail }}，10 分钟内有效</span></label>
              <input v-model="fCode" class="form-input auth-code" inputmode="numeric" maxlength="6" placeholder="6 位数字验证码" autocomplete="one-time-code">
            </div>
            <div class="form-group">
              <label>新密码</label>
              <input v-model="fPwd" type="password" class="form-input" autocomplete="new-password" placeholder="至少 6 位">
            </div>
            <div class="form-group">
              <label>确认新密码</label>
              <input v-model="fPwd2" type="password" class="form-input" autocomplete="new-password" placeholder="再输入一次">
              <span v-if="fPwd2 && fPwd !== fPwd2" class="auth-field-err">两次输入不一致</span>
            </div>
            <div v-if="error" class="auth-error">{{ error }}</div>
            <div v-else-if="notice" class="auth-notice">{{ notice }}</div>
            <button type="submit" class="btn-text primary auth-submit" :disabled="!fCanReset">
              <span v-if="busy" class="auth-spinner"></span>
              {{ busy ? '提交中…' : '重置密码' }}
            </button>
            <button type="button" class="auth-link" @click="switchTab('login')">返回登录</button>
          </template>
        </form>

        <p class="auth-hint">
          邮箱仅作为登录标识；忘记密码可通过注册邮箱接收验证码重置。验证码邮件由服务端发送，若未收到请检查垃圾箱。
        </p>
      </div>
    </div>
  </Teleport>
</template>
