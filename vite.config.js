import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'child_process'

const now = new Date()
const fmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})
const parts = fmt.formatToParts(now)
const p = (type) => parts.find(x => x.type === type).value
const buildTime = `${p('year')}/${p('month')}/${p('day')} ${p('hour')}:${p('minute')}`

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
