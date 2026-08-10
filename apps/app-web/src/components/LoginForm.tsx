'use client'

import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input } from 'antd'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { postJson } from '@/lib/client-api'

interface Values {
  email: string
  password: string
}

export function LoginForm() {
  const t = useTranslations()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  async function onFinish(values: Values) {
    setLoading(true)
    setErrorKey(null)

    const result = await postJson<{ ok: true }>('/api/auth/login', values)

    if (!result.ok) {
      setErrorKey(result.failure.messageKey)
      setLoading(false)
      return
    }

    router.replace('/home')
    router.refresh()
  }

  return (
    <Form<Values> layout="vertical" onFinish={onFinish} requiredMark={false}>
      {errorKey ? (
        <Alert type="error" showIcon message={t(errorKey)} style={{ marginBottom: 16 }} />
      ) : null}

      <Form.Item
        name="email"
        label={t('auth.login.email')}
        rules={[{ required: true }, { type: 'email' }]}
      >
        <Input size="large" autoComplete="email" prefix={<MailOutlined />} />
      </Form.Item>

      <Form.Item name="password" label={t('auth.login.password')} rules={[{ required: true }]}>
        <Input.Password size="large" autoComplete="current-password" prefix={<LockOutlined />} />
      </Form.Item>

      <Button type="primary" size="large" htmlType="submit" loading={loading} block>
        {t('auth.login.submit')}
      </Button>
    </Form>
  )
}
