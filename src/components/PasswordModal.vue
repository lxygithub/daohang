<script setup>
import { ref, watch, nextTick } from 'vue'
import { useToast } from '../composables/useToast'

const props = defineProps({
  visible: Boolean,
})

const emit = defineEmits(['verified', 'cancel'])
const { showToast } = useToast()

const password = ref('')
const inputRef = ref(null)
const showPassword = ref(false)

watch(() => props.visible, async (val) => {
  if (val) {
    password.value = ''
    showPassword.value = false
    await nextTick()
    inputRef.value?.focus()
  }
})

async function submit() {
  const pwd = password.value
  if (!pwd) {
    showToast('请输入密码')
    return
  }
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify', password: pwd }),
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json()
    if (data.ok) {
      emit('verified')
    } else {
      showToast('密码错误')
      password.value = ''
      inputRef.value?.focus()
    }
  } catch {
    showToast('验证失败，请重试')
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter') submit()
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) emit('cancel')
}
</script>

<template>
  <div class="modal-overlay" :class="{ active: visible }" @click="handleOverlayClick">
    <div class="modal" style="max-width:360px">
      <h2>身份验证</h2>
      <div class="form-group">
        <label>密码</label>
        <div class="password-input-wrapper">
          <input
            ref="inputRef"
            :type="showPassword ? 'text' : 'password'"
            class="form-input"
            v-model="password"
            placeholder="请输入密码"
            style="padding-right:40px"
            @keydown="handleKeydown"
          >
          <button class="toggle-vis" type="button" @click="showPassword = !showPassword">
            <svg v-if="!showPassword" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-text cancel" @click="emit('cancel')">取消</button>
        <button class="btn-text primary" @click="submit">确认</button>
      </div>
    </div>
  </div>
</template>
