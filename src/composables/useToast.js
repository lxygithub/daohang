import { ref } from 'vue'

const message = ref('')
const visible = ref(false)
let timer = null

export function useToast() {
  function showToast(msg) {
    message.value = msg
    visible.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      visible.value = false
    }, 2000)
  }

  return { message, visible, showToast }
}
