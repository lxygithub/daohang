// Minimal transactional mailer — plain fetch, no SDK.
// 支持 Brevo（优先）与 Resend 两个通道，按环境变量自动选择：
//   * BREVO_API_KEY   → Brevo 免费档 300 封/天，无需验证域名，
//                       只需在 Brevo 后台验证一个发件人邮箱
//   * RESEND_API_KEY  → Resend 免费档 100 封/天（需验证域名才能发任意用户）
//   * 都未配置时明确报错，绝不把验证码写进响应
//
// RESET_MAIL_FROM   发件人，格式 '名称 <邮箱>' 或纯邮箱（可选）：
//                     Brevo 必须是后台已验证的发件人邮箱，如 'daohang <xxx@qq.com>'
//                     Resend 默认 'daohang <onboarding@resend.dev>'（仅能发给自己）
// BREVO_API_BASE / RESEND_API_BASE  仅本地测试用（指向 mock）

const NAME_ADDR_RE = /^(.*?)\s*<([^>]+)>$/

/** 'daohang <a@b.c>' → { name: 'daohang', email: 'a@b.c' }；纯邮箱 → name 默认 'daohang' */
function parseFrom(raw, fallbackName = 'daohang') {
  const s = String(raw || '').trim()
  const m = s.match(NAME_ADDR_RE)
  if (m) return { name: (m[1] || fallbackName).trim(), email: m[2].trim() }
  return { name: fallbackName, email: s }
}

const RESET_HTML = code => [
  '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">',
  '<h2 style="margin:0 0 8px;font-size:18px">密码重置验证码</h2>',
  `<p style="margin:0 0 16px;color:#666;font-size:14px">你正在重置导航站的登录密码。验证码 <b>10 分钟内有效</b>，请勿泄露给他人。</p>`,
  `<div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#f4f5fa;border-radius:12px">${code}</div>`,
  '<p style="margin:16px 0 0;color:#999;font-size:12px">如果不是本人操作，请忽略此邮件，原密码不受影响。若未找到请检查垃圾箱。</p>',
  '</div>',
].join('')

async function sendViaBrevo(env, to, code) {
  const key = env.BREVO_API_KEY
  const base = env.BREVO_API_BASE || 'https://api.brevo.com'
  const fromRaw = env.RESET_MAIL_FROM
  if (!fromRaw) {
    throw new Error('发件人未配置：请在 Brevo 后台验证发件人邮箱，并设置 RESET_MAIL_FROM（如 daohang <you@qq.com>）')
  }
  const res = await fetch(`${base}/v3/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: parseFrom(fromRaw),
      to: [{ email: to }],
      subject: `【导航】密码重置验证码 ${code}`,
      htmlContent: RESET_HTML(code),
    }),
  })
  if (!res.ok) {
    // 只带状态码，不透传上游响应体（避免泄露内部信息）
    throw new Error(`邮件发送失败（${res.status}），请稍后再试`)
  }
}

async function sendViaResend(env, to, code) {
  const base = env.RESEND_API_BASE || 'https://api.resend.com'
  const from = env.RESET_MAIL_FROM || 'daohang <onboarding@resend.dev>'
  const res = await fetch(`${base}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: `【导航】密码重置验证码 ${code}`, html: RESET_HTML(code) }),
  })
  if (!res.ok) throw new Error(`邮件发送失败（${res.status}），请稍后再试`)
}

export async function sendResetCode(env, to, code) {
  if (env.BREVO_API_KEY) return sendViaBrevo(env, to, code)
  if (env.RESEND_API_KEY) return sendViaResend(env, to, code)
  throw new Error('邮件服务未配置（BREVO_API_KEY），请联系管理员或稍后再试')
}
