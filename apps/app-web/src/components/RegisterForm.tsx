'use client'

import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input } from 'antd'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { postJson } from '@/lib/client-api'
import { POST_AUTH_LANDING } from '@/lib/routes'

interface Values {
  name?: string
  email: string
  password: string
}

export function RegisterForm() {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  async function onFinish(values: Values) {
    setLoading(true)
    setErrorKey(null)

    const result = await postJson<{ ok: true; redirectTo: string }>('/api/auth/register', {
      ...values,
      locale,
    })

    if (!result.ok) {
      setErrorKey(result.failure.messageKey)
      setLoading(false)
      return
    }

    // AC-1 — registration signs the user in, so go straight to Home.
    router.replace(POST_AUTH_LANDING)
    router.refresh()
  }

  return (
    <Form<Values> layout="vertical" onFinish={onFinish} requiredMark={false}>
      {errorKey ? (
        <Alert type="error" showIcon message={t(errorKey)} style={{ marginBottom: 16 }} />
      ) : null}

      <Form.Item name="name" label={t('auth.register.name')}>
        <Input size="large" autoComplete="nickname" prefix={<UserOutlined />} />
      </Form.Item>

      <Form.Item
        name="email"
        label={t('auth.register.email')}
        rules={[{ required: true }, { type: 'email', message: t('errors.invalidEmail') }]}
      >
        <Input size="large" autoComplete="email" prefix={<MailOutlined />} />
      </Form.Item>

      <Form.Item
        name="password"
        label={t('auth.register.password')}
        extra={t('auth.register.passwordHint')}
        rules={[
          { required: true },
          { min: 8, message: t('errors.passwordTooShort') },
          {
            pattern: /^(?=.*[a-zA-Z])(?=.*[0-9]).+$/,
            message: t('errors.passwordTooWeak'),
          },
        ]}
      >
        <Input.Password size="large" autoComplete="new-password" prefix={<LockOutlined />} />
      </Form.Item>

      <Button type="primary" size="large" htmlType="submit" loading={loading} block>
        {t('auth.register.submit')}
      </Button>
    </Form>
  )
}
