import { getTranslations } from 'next-intl/server'
import { AppUsersTable } from '@/components/AppUsersTable'
import { Title } from '@/components/typography'
import { requireAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function AppUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await requireAdmin(locale, 'appUser.view')

  const t = await getTranslations({ locale, namespace: 'appUsers' })

  return (
    <>
      <Title level={4}>{t('title')}</Title>
      <AppUsersTable />
    </>
  )
}
