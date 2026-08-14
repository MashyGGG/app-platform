import 'server-only'
import { prisma } from '@app/db'
import {
  PROGRESS_WINDOW_DAYS,
  toDateKey,
  weeklyProgress,
  type WeeklyProgress,
} from '@app/shared/speaking'

/**
 * `/me` — 7 天模板句 + 完成日历，只读 (SPEC §4.3 P4/§5.3 `GET /me/week`, AC-S8).
 *
 * The same payload closes the loop on `/today`: P4 收工 shows 「今天练完了」
 * **plus** the week line, so the retry/skip routes return this too rather than
 * making the client fetch it — the sentence is the reward for finishing, and a
 * second round trip is a second chance to not show it.
 */

export interface WeekDayView {
  /** `YYYY-MM-DD` in the product's day (see `toDateKey`). */
  date: string
  completed: boolean
  winnerType: 'A' | 'B' | 'C' | null
  retryState: 'PENDING' | 'DONE' | 'SKIPPED' | null
}

export interface WeekView {
  /** Oldest first, exactly `PROGRESS_WINDOW_DAYS` cells, today last. */
  days: WeekDayView[]
  completedDays: number
  /** `null` until the first completion — the caller shows an empty-state line. */
  progress: WeeklyProgress | null
}

/** The last seven day keys, oldest first, ending today. */
function windowKeys(now: Date): string[] {
  return Array.from({ length: PROGRESS_WINDOW_DAYS }, (_, index) =>
    toDateKey(new Date(now.getTime() - (PROGRESS_WINDOW_DAYS - 1 - index) * 86_400_000)),
  )
}

export async function getWeekView(userId: string, now = new Date()): Promise<WeekView> {
  // "最近 ≤7 条" is the sentence's input (SPEC §5.1) and it is a count of
  // records, not of days: a student who missed Tuesday should still get a line
  // about the seven times they did practise. The calendar below is the other
  // reading — seven consecutive dates — and the two are deliberately different
  // queries over the same rows.
  const recent = await prisma.speakingDailyCompletion.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: PROGRESS_WINDOW_DAYS,
    select: { date: true, winnerType: true, retryState: true },
  })

  const byDate = new Map(
    recent.map((row) => [
      // Stored as a DATE at UTC midnight, so slicing the ISO string is the
      // inverse of `dateOf` in complete.ts — no timezone shift may be applied
      // here, or a completion would land on the wrong calendar cell.
      row.date.toISOString().slice(0, 10),
      row,
    ]),
  )

  const days = windowKeys(now).map<WeekDayView>((date) => {
    const row = byDate.get(date)
    return {
      date,
      completed: Boolean(row),
      winnerType: row?.winnerType ?? null,
      retryState: row?.retryState ?? null,
    }
  })

  return {
    days,
    completedDays: days.filter((day) => day.completed).length,
    progress: weeklyProgress(recent.map((row) => row.winnerType)),
  }
}
