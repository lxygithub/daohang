import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'child_process'

const now = new Date()
const Y = now.getFullYear()
const M = String(now.getMonth() + 1).padStart(2, '0')
const D = String(now.getDate()).padStart(2, '0')
const h = String(now.getHours()).padStart(2, '0')
const m = String(now.getMinutes()).padStart(2, '0')
const buildTime = `${Y}/${M}/${D} ${h}:${m}`

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    __COMMIT_HASH__: JSON.stringify('v' + execSync('git rev-parse --short HEAD').toString().trim()),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
})
