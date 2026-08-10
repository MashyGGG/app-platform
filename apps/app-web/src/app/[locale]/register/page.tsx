import { Space } from 'antd'
import { getTranslations } from 'next-intl/server'
import { AuthShell } from '@/components/AuthShell'
import { RegisterForm } from '@/components/RegisterForm'
import { Link } from '@/i18n/navigation'

export const dynamic = 'force-dynamic'

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.register' })

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <RegisterForm />
      <Space className="mt-6">
        {t('haveAccount')} <Link href="/login">{t('login')}</Link>
      </Space>
    </AuthShell>
  )
}
