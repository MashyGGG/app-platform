'use client'

import { CheckOutlined } from '@ant-design/icons'
import { useTranslations } from 'next-intl'
import type { WeekDayView } from '@/lib/speaking/week'

/**
 * 完成日历 — seven cells, oldest first, today last (SPEC §4.3 P4).
 *
 * A calendar, not a streak counter: a streak punishes the day you miss, which is
 * precisely the pressure D3 says drives people off. Seven filled-or-not cells
 * say the same thing about the days you did show up and nothing at all about the
 * ones you did not.
 *
 * Deliberately unclickable. `/me` is read-only (SPEC §5.3), and a past day is
 * not a place you can go back and practise — that would reopen the "补课" loop
 * the one-question-a-day rule exists to close.
 */
export function WeekStrip({ days }: { days: readonly WeekDayView[] }) {
  const t = useTranslations('me')

  return (
    <div data-testid="week-strip" className="flex gap-2" aria-label={t('calendar')}>
      {days.map((day, index) => (
        <div
          key={day.date}
          data-testid="week-day"
          data-date={day.date}
          data-completed={day.completed ? 'true' : 'false'}
          title={day.date}
          className={[
            'flex flex-1 flex-col items-center gap-1 rounded border py-2 text-xs',
            day.completed ? 'border-green-500 text-green-600' : 'border-gray-200 text-gray-400',
          ].join(' ')}
        >
          {/* `MM-DD` off the key rather than a formatted date: the key is already
              the product's calendar day, and re-deriving it from a Date in the
              browser would reintroduce the timezone shift `toDateKey` removes. */}
          <span>{day.date.slice(5)}</span>
          <span aria-hidden>{day.completed ? <CheckOutlined /> : '·'}</span>
          <span className="sr-only">
            {t(day.completed ? 'dayDone' : 'dayEmpty')}
            {index === days.length - 1 ? ` (${t('today')})` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
