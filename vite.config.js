import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'child_process'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    __COMMIT_HASH__: JSON.stringify('v' + execSync('git rev-parse --short HEAD').toString().trim()),
  },
})
