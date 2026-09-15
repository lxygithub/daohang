// Minimal Resend mailer — plain fetch, no SDK.
// 环境变量：
//   RESEND_API_KEY   （必需，secret；未配置时明确报错，绝不把验证码写进响应）
//   RESET_MAIL_FROM  （可选，默认 'daohang <onboarding@resend.dev>'；
//                     Resend 未验证自有域名前只能发给注册者本人邮箱，
//                     正式使用请在 Resend 完成域名验证后改为自有域地址）
//   RESEND_API_BASE  （可选，仅本地测试用，默认 https://api.resend.com）

export async function sendResetCode(env, to, code) {
  const key = env.RESEND_API_KEY
  if (!key) throw new Error('邮件服务未配置（RESEND_API_KEY），请联系管理员或稍后再试')

  const from = env.RESET_MAIL_FROM || 'daohang <onboarding@resend.dev>'
  const base = env.RESEND_API_BASE || 'https://api.resend.com'

  const res = await fetch(`${base}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: `【导航】密码重置验证码 ${code}`,
      html: [
        '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">',
        '<h2 style="margin:0 0 8px;font-size:18px">密码重置验证码</h2>',
        `<p style="margin:0 0 16px;color:#666;font-size:14px">你正在重置导航站的登录密码。验证码 <b>10 分钟内有效</b>，请勿泄露给他人。</p>`,
        `<div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#f4f5fa;border-radius:12px">${code}</div>`,
        '<p style="margin:16px 0 0;color:#999;font-size:12px">如果不是本人操作，请忽略此邮件，原密码不受影响。</p>',
        '</div>',
      ].join(''),
    }),
  })

  if (!res.ok) {
    // 只带状态码，不透传上游响应体（避免泄露内部信息）
    throw new Error(`邮件发送失败（${res.status}），请稍后再试`)
  }
}
