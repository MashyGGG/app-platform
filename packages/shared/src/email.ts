import { Resend } from 'resend'

let resend: Resend | null = null

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  resend ??= new Resend(key)
  return resend
}

export interface ResetEmailInput {
  to: string
  resetUrl: string
  locale: 'zh' | 'en'
}

const COPY = {
  zh: {
    subject: '重置你的密码',
    intro:
      '我们收到了重置你账号密码的请求。点击下面的链接设置新密码，链接 1 小时内有效，且只能使用一次。',
    cta: '重置密码',
    ignore: '如果不是你本人操作，忽略这封邮件即可。',
  },
  en: {
    subject: 'Reset your password',
    intro:
      'We received a request to reset your password. Use the link below to set a new one — it expires in 1 hour and can only be used once.',
    cta: 'Reset password',
    ignore: 'If you did not request this, you can safely ignore this email.',
  },
} as const

const OTP_COPY = {
  zh: {
    subject: '你的登录验证码',
    intro: (minutes: number) => `这是你的一次性登录验证码，${minutes} 分钟内有效，只能使用一次。`,
    ignore: '如果不是你本人操作，忽略这封邮件即可，你的账号不会有任何变化。',
  },
  en: {
    subject: 'Your sign-in code',
    intro: (minutes: number) =>
      `Here is your one-time sign-in code. It expires in ${minutes} minutes and can only be used once.`,
    ignore: 'If you did not request this, you can safely ignore this email — nothing will change.',
  },
} as const

export interface OtpEmailInput {
  to: string
  code: string
  locale: 'zh' | 'en'
  ttlMs: number
}

/**
 * Sends the passwordless sign-in code (AC-S9). Same offline behaviour as the
 * reset email: with no RESEND_API_KEY the code is printed to the server console,
 * which is what keeps local development and CI at zero cost and zero delivery.
 */
export async function sendOtpEmail({ to, code, locale, ttlMs }: OtpEmailInput): Promise<boolean> {
  const copy = OTP_COPY[locale]
  const minutes = Math.max(1, Math.round(ttlMs / 60_000))
  const client = getResend()

  if (!client) {
    console.info(`[email:dev] sign-in code for ${to} -> ${code}`)
    return false
  }

  await client.emails.send({
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to,
    subject: copy.subject,
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">
  <p>${copy.intro(minutes)}</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
  <p style="color:#888;font-size:12px">${copy.ignore}</p>
</div>`,
  })

  return true
}

/**
 * Sends the password-reset email. When RESEND_API_KEY is absent (local dev) the
 * link is printed to the server console instead, so AC-4 can still be walked
 * through offline. Returns `true` when a real email was dispatched.
 */
export async function sendResetPasswordEmail({
  to,
  resetUrl,
  locale,
}: ResetEmailInput): Promise<boolean> {
  const copy = COPY[locale]
  const client = getResend()

  if (!client) {
    console.info(`[email:dev] password reset for ${to} -> ${resetUrl}`)
    return false
  }

  await client.emails.send({
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to,
    subject: copy.subject,
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">
  <p>${copy.intro}</p>
  <p><a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#1677ff;color:#fff;border-radius:6px;text-decoration:none">${copy.cta}</a></p>
  <p style="color:#888;font-size:12px">${copy.ignore}</p>
</div>`,
  })

  return true
}
