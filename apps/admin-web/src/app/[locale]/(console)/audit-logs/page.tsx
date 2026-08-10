import { getTranslations } from 'next-intl/server'
import { AuditLogTable } from '@/components/AuditLogTable'
import { Paragraph, Title } from '@/components/typography'
import { requireAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function AuditLogsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await requireAdmin(locale, 'audit.view')

  const t = await getTranslations({ locale, namespace: 'audit' })

  return (
    <>
      <Title level={4}>{t('title')}</Title>
      <Paragraph type="secondary">{t('subtitle')}</Paragraph>
      <AuditLogTable />
    </>
  )
}
