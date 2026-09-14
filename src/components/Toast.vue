<script setup>
defineProps({
  message: { type: String, default: '' },
  visible: Boolean,
})
</script>

<template>
  <div class="toast" :class="{ show: visible }">{{ message }}</div>
</template>
