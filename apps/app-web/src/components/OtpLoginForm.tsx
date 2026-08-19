'use client'

import { MailOutlined, NumberOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Space } from 'antd'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
// The `/otp` subpath, not `@app/shared/speaking`: the barrel also re-exports the
// `node:crypto` hashing half, which must never reach a browser bundle.
import { OTP_CODE_LENGTH, OTP_RESEND_COOLDOWN_SEC } from '@app/shared/speaking/otp'
import { useRouter } from '@/i18n/navigation'
import { postJson } from '@/lib/client-api'
import { POST_AUTH_LANDING } from '@/lib/routes'

interface RequestResult {
  ok: true
  expiresInSec: number
  /** Only ever present when OTP_DEV_ECHO=1 — dev and e2e, never production. */
  devCode?: string
}

/**
 * AC-S9 — email, then a six-digit code. Two steps in ONE component and one
 * route: there is no password field to fall back to, so bouncing the user
 * between pages would only add ways to lose the code they just received.
 */
export function OtpLoginForm() {
  const t = useTranslations()
  const locale = useLocale() as 'zh' | 'en'
  const router = useRouter()

  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [prefill, setPrefill] = useState('')
  const [codeForm] = Form.useForm<{ code: string }>()

  /**
   * Applied from an effect, not straight out of the fetch: when the response
   * lands the code step has not been rendered yet, and antd silently discards
   * `setFieldsValue` on a form instance that is not connected to a mounted
   * <Form>. By the time this runs, it is.
   */
  useEffect(() => {
    if (prefill) codeForm.setFieldsValue({ code: prefill })
  }, [prefill, codeForm])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function sendCode(address: string) {
    setLoading(true)
    setErrorKey(null)

    const result = await postJson<RequestResult>('/api/auth/otp/request', {
      email: address,
      locale,
    })
    setLoading(false)

    if (!result.ok) {
      setErrorKey(result.failure.messageKey)
      return
    }

    setEmail(address)
    setCooldown(OTP_RESEND_COOLDOWN_SEC)
    // Local development and e2e have no inbox: the server hands the code back
    // rather than mailing it, so fill it in instead of asking for the
    // impossible. In production this field is simply never there.
    if (result.data.devCode) setPrefill(result.data.devCode)
  }

  async function verifyCode(values: { code: string }) {
    if (!email) return
    setLoading(true)
    setErrorKey(null)

    const result = await postJson<{ ok: true; redirectTo: string }>('/api/auth/otp/verify', {
      email,
      code: values.code,
      locale,
    })

    if (!result.ok) {
      setErrorKey(result.failure.messageKey)
      setLoading(false)
      return
    }

    router.replace(POST_AUTH_LANDING)
    router.refresh()
  }

  const alert = errorKey ? (
    <Alert type="error" showIcon message={t(errorKey)} style={{ marginBottom: 16 }} />
  ) : null

  if (email === null) {
    return (
      <Form<{ email: string }>
        // Distinct keys for the two steps: both render a <Form> at the same
        // position, so without them React reuses one component instance and the
        // code step never really mounts — which is how `codeForm` ends up
        // unbound and its prefilled value disappears.
        key="otp-email-step"
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => sendCode(values.email)}
      >
        {alert}
        <Form.Item
          name="email"
          label={t('auth.otp.email')}
          rules={[{ required: true }, { type: 'email' }]}
        >
          <Input size="large" autoComplete="email" prefix={<MailOutlined />} />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" loading={loading} block>
          {t('auth.otp.sendCode')}
        </Button>
      </Form>
    )
  }

  return (
    <Form<{ code: string }>
      key="otp-code-step"
      form={codeForm}
      layout="vertical"
      requiredMark={false}
      // The step mounts with the code already in state, so this alone fills the
      // field; the effect above only has to cover a resend, where the form is
      // already mounted and initialValues no longer apply.
      initialValues={{ code: prefill }}
      onFinish={verifyCode}
    >
      {alert}
      <Alert
        type="info"
        showIcon
        message={t('auth.otp.sent', { email })}
        style={{ marginBottom: 16 }}
      />

      <Form.Item
        name="code"
        label={t('auth.otp.code')}
        extra={t('auth.otp.codeHint')}
        rules={[{ required: true }, { pattern: /^\d{6}$/, message: t('errors.invalidOtpCode') }]}
      >
        <Input
          size="large"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_CODE_LENGTH}
          prefix={<NumberOutlined />}
        />
      </Form.Item>

      <Button type="primary" size="large" htmlType="submit" loading={loading} block>
        {t('auth.otp.verify')}
      </Button>

      <Space className="mt-4 w-full justify-between">
        <Button type="link" disabled={cooldown > 0 || loading} onClick={() => sendCode(email)}>
          {cooldown > 0 ? t('auth.otp.resendIn', { seconds: cooldown }) : t('auth.otp.resend')}
        </Button>
        <Button
          type="link"
          onClick={() => {
            setEmail(null)
            setErrorKey(null)
            setPrefill('')
            codeForm.resetFields()
          }}
        >
          {t('auth.otp.changeEmail')}
        </Button>
      </Space>
    </Form>
  )
}
