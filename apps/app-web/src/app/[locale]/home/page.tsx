import { Card, Descriptions, Tag } from 'antd'
import { getFormatter, getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { SignOutButton } from '@/components/SignOutButton'
import { Paragraph, Title } from '@/components/typography'
import { requireUser } from '@/lib/session'

// Never cached: the disabled-user check must run on every single request.
export const dynamic = 'force-dynamic'

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params

  // SPEC §1.4 — re-reads User.status from the DB. A disabled user lands here
  // with a perfectly valid JWT and is still bounced (AC-8).
  const user = await requireUser(locale)

  const t = await getTranslations({ locale, namespace: 'home' })
  const format = await getFormatter({ locale })

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <Title level={4} style={{ margin: 0 }}>
          {t('title')}
        </Title>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <SignOutButton />
        </div>
      </div>

      <Card>
        {/* AC-5 */}
        <Title level={2}>{t('hello')}</Title>
        <Paragraph type="secondary">
          {t('welcome')}
          {user.name ? `, ${user.name}` : ''}
        </Paragraph>

        {/* The `items` API, not <Descriptions.Item> — compound statics don't
            survive the RSC client boundary. */}
        <Descriptions
          column={1}
          bordered
          size="small"
          items={[
            { key: 'email', label: t('email'), children: user.email },
            { key: 'name', label: t('name'), children: user.name ?? '—' },
            { key: 'locale', label: t('locale'), children: user.locale },
            {
              key: 'status',
              label: t('status'),
              children: (
                <Tag color={user.status === 'active' ? 'green' : 'red'}>
                  {user.status === 'active' ? t('statusActive') : t('statusDisabled')}
                </Tag>
              ),
            },
            {
              key: 'createdAt',
              label: t('createdAt'),
              children: format.dateTime(user.createdAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            },
          ]}
        />
      </Card>
    </main>
  )
}
