'use client'

import { MailOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input } from 'antd'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { postJson } from '@/lib/client-api'

export function ForgotPasswordForm() {
  const t = useTranslations()
  const locale = useLocale()
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  async function onFinish(values: { email: string }) {
    setLoading(true)
    setErrorKey(null)

    const result = await postJson<{ ok: true }>('/api/auth/forgot-password', {
      email: values.email,
      locale,
    })

    setLoading(false)
    if (!result.ok) {
      setErrorKey(result.failure.messageKey)
      return
    }
    // Same response whether or not the address exists — no account enumeration.
    setSent(true)
  }

  if (sent) {
    return <Alert type="success" showIcon message={t('auth.forgot.sent')} />
  }

  return (
    <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
      {errorKey ? (
        <Alert type="error" showIcon message={t(errorKey)} style={{ marginBottom: 16 }} />
      ) : null}

      <Form.Item
        name="email"
        label={t('auth.forgot.email')}
        rules={[{ required: true }, { type: 'email', message: t('errors.invalidEmail') }]}
      >
        <Input size="large" autoComplete="email" prefix={<MailOutlined />} />
      </Form.Item>

      <Button type="primary" size="large" htmlType="submit" loading={loading} block>
        {t('auth.forgot.submit')}
      </Button>
    </Form>
  )
}
