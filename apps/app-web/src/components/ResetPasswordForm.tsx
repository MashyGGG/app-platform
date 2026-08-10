'use client'

import { LockOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input } from 'antd'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { postJson } from '@/lib/client-api'

interface Values {
  password: string
  confirm: string
}

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  async function onFinish(values: Values) {
    setLoading(true)
    setErrorKey(null)

    const result = await postJson<{ ok: true }>('/api/auth/reset-password', {
      token,
      email,
      password: values.password,
    })

    setLoading(false)
    if (!result.ok) {
      setErrorKey(result.failure.messageKey)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <>
        <Alert type="success" showIcon message={t('auth.reset.success')} />
        <div className="mt-4">
          <Link href="/login">{t('auth.reset.goLogin')}</Link>
        </div>
      </>
    )
  }

  return (
    <Form<Values> layout="vertical" onFinish={onFinish} requiredMark={false}>
      {errorKey ? (
        <Alert type="error" showIcon message={t(errorKey)} style={{ marginBottom: 16 }} />
      ) : null}

      <Form.Item
        name="password"
        label={t('auth.reset.password')}
        rules={[
          { required: true },
          { min: 8, message: t('errors.passwordTooShort') },
          { pattern: /^(?=.*[a-zA-Z])(?=.*[0-9]).+$/, message: t('errors.passwordTooWeak') },
        ]}
      >
        <Input.Password size="large" autoComplete="new-password" prefix={<LockOutlined />} />
      </Form.Item>

      <Form.Item
        name="confirm"
        label={t('auth.reset.confirm')}
        dependencies={['password']}
        rules={[
          { required: true },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) return Promise.resolve()
              return Promise.reject(new Error(t('errors.passwordMismatch')))
            },
          }),
        ]}
      >
        <Input.Password size="large" autoComplete="new-password" prefix={<LockOutlined />} />
      </Form.Item>

      <Button type="primary" size="large" htmlType="submit" loading={loading} block>
        {t('auth.reset.submit')}
      </Button>
    </Form>
  )
}
