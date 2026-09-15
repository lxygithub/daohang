// 极简自建图床 mock（本地测试 /api/upload 转发用）：
//   * 接受任意 multipart POST，返回常见图床 JSON 结构 { code, data: { url } }
//   * GET /last 可查看最近一次上传的元信息
// 用法：node scripts/mock-imgbed.mjs   （端口 9001，可用 PORT 覆盖）
import http from 'node:http'

const PORT = Number(process.env.PORT || 9001)
let last = null

http.createServer((req, res) => {
  if (req.method === 'POST') {
    let size = 0
    req.on('data', (c) => { size += c.length }) // 消费请求体即可，无需解析 multipart
    req.on('end', () => {
      const ct = req.headers['content-type'] || ''
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`
      last = { at: new Date().toISOString(), size, contentType: ct }
      // CloudFlare-ImgBed 真实响应形态：JSON 数组 + 相对路径 src
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ src: `/file/${id}` }]))
    })
  } else if (req.method === 'GET' && req.url === '/last') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(last || {}))
  } else {
    res.writeHead(404)
    res.end()
  }
}).listen(PORT, () => console.log(`mock imgbed on http://127.0.0.1:${PORT}`))
