import { Card, Space } from 'antd'
import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { SignOutButton } from '@/components/SignOutButton'
import { WeekStrip } from '@/components/speaking/WeekStrip'
import { Paragraph, Title } from '@/components/typography'
import { Link } from '@/i18n/navigation'
import { requireUser } from '@/lib/session'
import { getWeekView } from '@/lib/speaking/week'

// Never cached: `requireUser` re-reads User.status, and the seven-day window
// this page draws moves every midnight.
export const dynamic = 'force-dynamic'

/**
 * AC-S8 — "WHEN 学生查看 `/me`，THE 系统 SHALL 展示由最近 ≤7 条完成记录**按固定
 * 模板**生成的一句进步文案，且不调用 LLM."
 *
 * Read-only, and short on purpose: this is 「能感到在进步」 (D9), not a dashboard.
 * One sentence, seven cells, and a way back to today's question. The sentence
 * itself comes from `weeklyProgress`, a pure function over winner types — so
 * "不调用 LLM" is a property of the code path rather than a promise someone has
 * to go and verify in a log.
 */
export default async function MePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const user = await requireUser(locale)
  // Un-namespaced: the progress line arrives as a fully qualified key
  // (`me.progress.A`) from the shared module, exactly like the coach lines do.
  const t = await getTranslations({ locale })

  const week = await getWeekView(user.id)

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <Title level={4} style={{ margin: 0 }}>
          {t('me.title')}
        </Title>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <SignOutButton />
        </div>
      </div>

      <Space direction="vertical" size="large" className="w-full">
        <Card>
          <Paragraph data-testid="progress-line" style={{ marginBottom: 0 }}>
            {week.progress ? t(week.progress.key, week.progress.params) : t('me.empty')}
          </Paragraph>
        </Card>

        <Card title={t('me.calendar')}>
          <WeekStrip days={week.days} />
          <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            {t('me.completedDays', { count: week.completedDays, days: week.days.length })}
          </Paragraph>
        </Card>

        <Paragraph style={{ marginBottom: 0 }}>
          <Link href="/today">{t('me.backToToday')}</Link>
        </Paragraph>
      </Space>
    </main>
  )
}
