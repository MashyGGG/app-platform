import { getTranslations } from 'next-intl/server'
import { AuthShell } from '@/components/AuthShell'
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm'
import { Link } from '@/i18n/navigation'

export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.forgot' })

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <ForgotPasswordForm />
      <div className="mt-6">
        <Link href="/login">{t('backToLogin')}</Link>
      </div>
    </AuthShell>
  )
}
