import { Space } from 'antd'
import { getTranslations } from 'next-intl/server'
import { AuthShell } from '@/components/AuthShell'
import { LoginForm } from '@/components/LoginForm'
import { Link } from '@/i18n/navigation'

export const dynamic = 'force-dynamic'

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.login' })

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <LoginForm />

      <Space className="mt-6 w-full justify-between">
        <Link href="/forgot-password">{t('forgot')}</Link>
        <span>
          {t('noAccount')} <Link href="/register">{t('register')}</Link>
        </span>
      </Space>
    </AuthShell>
  )
}
