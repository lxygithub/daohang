// 本地测试用邮件 mock：同时兼容 Resend（POST /emails）与 Brevo（POST /v3/smtp/email）
// 两种请求体，暴露 GET /last-code 供测试脚本取验证码
// 用法：node scripts/mock-resend.mjs [port=9999]
import http from 'node:http'

const port = Number(process.argv[2] || 9999)
let lastCode = ''

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && (req.url === '/emails' || req.url === '/v3/smtp/email')) {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const payload = JSON.parse(body)
        // Resend: { to, subject, html }；Brevo: { to: [{email}], subject, htmlContent }
        const to = Array.isArray(payload.to) ? payload.to.map(t => t.email).join(',') : payload.to
        const text = String(payload.subject || payload.html || payload.htmlContent || '')
        const m = text.match(/\b(\d{6})\b/)
        lastCode = m ? m[1] : ''
        console.log(`[mock-resend] mail to=${to} subject="${payload.subject}" code=${lastCode}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'mock-' + Date.now() }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }
  if (req.method === 'GET' && req.url === '/last-code') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ code: lastCode }))
    return
  }
  res.writeHead(404)
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => console.log(`[mock-resend] listening on http://127.0.0.1:${port}`))
