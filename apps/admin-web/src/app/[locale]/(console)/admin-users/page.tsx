import { getTranslations } from 'next-intl/server'
import { AdminUsersTable } from '@/components/AdminUsersTable'
import { Title } from '@/components/typography'
import { requireAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

/** AC-7 — super_admin only. An operator is redirected before this ever renders. */
export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await requireAdmin(locale, 'adminUser.view')

  const t = await getTranslations({ locale, namespace: 'adminUsers' })

  return (
    <>
      <Title level={4}>{t('title')}</Title>
      <AdminUsersTable />
    </>
  )
}
