import { Card } from 'antd'
import { getTranslations } from 'next-intl/server'
import { AdminLoginForm } from '@/components/AdminLoginForm'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { Paragraph, Title } from '@/components/typography'

export const dynamic = 'force-dynamic'

export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ signedOut?: string }>
}) {
  const { locale } = await params
  const { signedOut } = await searchParams
  const t = await getTranslations({ locale, namespace: 'login' })

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-2 flex justify-end">
          <LocaleSwitcher />
        </div>
        <Card>
          <Title level={3} style={{ marginBottom: 4 }}>
            {t('title')}
          </Title>
          <Paragraph type="secondary">{t('subtitle')}</Paragraph>

          <AdminLoginForm signedOut={signedOut === '1'} />
        </Card>
      </div>
    </main>
  )
}
