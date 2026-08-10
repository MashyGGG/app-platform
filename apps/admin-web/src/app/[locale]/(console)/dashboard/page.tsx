import { Alert, Card, Col, Row, Statistic, Tag } from 'antd'
import { getTranslations } from 'next-intl/server'
import { Paragraph, Title } from '@/components/typography'
import { getDashboardSummary } from '@/lib/dashboard'
import { requireAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ denied?: string }>
}) {
  const { locale } = await params
  const { denied } = await searchParams

  await requireAdmin(locale, 'dashboard.view')

  const t = await getTranslations({ locale, namespace: 'dashboard' })
  const tc = await getTranslations({ locale, namespace: 'common' })

  // AC-9 — aggregates, served from a 60s Redis cache when warm.
  const { data, cached } = await getDashboardSummary()

  const tiles = [
    { key: 'appUsers', value: data.appUsers },
    { key: 'appUsersDisabled', value: data.appUsersDisabled },
    { key: 'adminUsers', value: data.adminUsers },
    { key: 'superAdmins', value: data.superAdmins },
    { key: 'operators', value: data.operators },
    { key: 'newUsers7d', value: data.newUsers7d },
    { key: 'auditLogs', value: data.auditLogs },
    { key: 'auditLogs24h', value: data.auditLogs24h },
  ] as const

  return (
    <>
      {denied === '1' ? (
        <Alert type="warning" showIcon message={tc('noPermission')} className="mb-4" />
      ) : null}

      <div className="mb-4 flex items-center gap-3">
        <Title level={4} style={{ margin: 0 }}>
          {t('title')}
        </Title>
        <Tag color={cached ? 'blue' : 'green'}>{cached ? t('cached') : t('fresh')}</Tag>
      </div>

      <Row gutter={[16, 16]}>
        {tiles.map((tile) => (
          <Col key={tile.key} xs={12} md={8} xl={6}>
            <Card>
              <Statistic title={t(tile.key)} value={tile.value} />
            </Card>
          </Col>
        ))}
      </Row>

      <Paragraph type="secondary" className="mt-4">
        {t('cacheNote')}
      </Paragraph>
    </>
  )
}
