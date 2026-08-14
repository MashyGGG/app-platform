import { getTranslations } from 'next-intl/server'
import { AuthShell } from '@/components/AuthShell'
import { OtpLoginForm } from '@/components/OtpLoginForm'
import { Link } from '@/i18n/navigation'

export const dynamic = 'force-dynamic'

/**
 * Passwordless sign-in (AC-S9). The daily-speaking product's only door; the
 * existing email + password pages stay exactly as they were (IMPL §3-C2).
 */
export default async function AuthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.otp' })

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <OtpLoginForm />

      <div className="mt-6">
        <Link href="/login">{t('usePassword')}</Link>
      </div>
    </AuthShell>
  )
}
