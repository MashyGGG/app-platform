import { Alert } from 'antd'
import { getTranslations } from 'next-intl/server'
import { AuthShell } from '@/components/AuthShell'
import { ResetPasswordForm } from '@/components/ResetPasswordForm'
import { Link } from '@/i18n/navigation'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string; email?: string }>
}) {
  const { locale } = await params
  const { token, email } = await searchParams
  const t = await getTranslations({ locale, namespace: 'auth.reset' })

  if (!token || !email) {
    return (
      <AuthShell title={t('title')}>
        <Alert type="error" showIcon message={t('missingToken')} />
        <div className="mt-4">
          <Link href="/forgot-password">{t('goLogin')}</Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <ResetPasswordForm token={token} email={email} />
    </AuthShell>
  )
}
