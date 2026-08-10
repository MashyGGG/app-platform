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
        {/*
          Password reset is switched off for now. Its pages and API routes still
          exist, in folders renamed to `_forgot-password` / `_reset-password` —
          a leading underscore makes Next.js treat a folder as private and leave
          it out of routing entirely, so the code is intact but unreachable.
          To bring the feature back: drop the underscores and uncomment below.

          <Link href="/forgot-password">{t('forgot')}</Link>
        */}
        <span>
          {t('noAccount')} <Link href="/register">{t('register')}</Link>
        </span>
      </Space>
    </AuthShell>
  )
}
