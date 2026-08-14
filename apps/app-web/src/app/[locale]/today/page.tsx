import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { SignOutButton } from '@/components/SignOutButton'
import { TodaySession } from '@/components/speaking/TodaySession'
import { Title } from '@/components/typography'
import { requireUser } from '@/lib/session'
import { getOrCreateTodaySession } from '@/lib/speaking/today'

// Never cached: `requireUser` re-reads User.status, and "today" is a moving
// target — a cached render would serve yesterday's prompt after midnight.
export const dynamic = 'force-dynamic'

/**
 * AC-S1 — "THE 系统 SHALL 展示今日题目与录音控件，且不展示任何模块/菜单列表."
 *
 * So: no sidebar, no nav, no course tree, no module wall. The page holds one
 * question and one record button, and the only other controls are the language
 * toggle and sign-out. That absence IS the acceptance criterion (SPEC §4.3
 * 信息架构 — 无侧栏), not a stage the UI grows out of later.
 *
 * The session is created here rather than by a client fetch so the recorder has
 * an id the moment the page paints — AC-S2's ten seconds are counted from this
 * render, and a round trip spent asking for a session id would come out of them.
 */
export default async function TodayPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const user = await requireUser(locale)
  const t = await getTranslations({ locale, namespace: 'today' })

  const today = await getOrCreateTodaySession(user.id)

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <Title level={4} style={{ margin: 0 }}>
          {t('title')}
        </Title>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <SignOutButton />
        </div>
      </div>

      <TodaySession initial={today} />
    </main>
  )
}
