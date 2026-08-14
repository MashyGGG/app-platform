/**
 * The 7 天进步句 — "纯模板，零 LLM" (SPEC §5.1 收工与 7 天句, AC-S8).
 *
 * A template is not a downgrade from a generated sentence here, it is the
 * requirement: AC-S8's 测法 is "构造 4A/2B/1C → 文案等于「把话说清 … 4 次」模板；
 * 日志无 LLM 调用". A model-written line cannot be asserted, and a line that
 * cannot be asserted cannot be shipped as an acceptance criterion. Keeping this
 * a pure function over a list of winner types is what makes the claim structural
 * rather than something a reviewer has to go and check in a log.
 */
import type { WinnerType } from './winner'

/** 「7 天里 N 次」 — the window the sentence talks about. */
export const PROGRESS_WINDOW_DAYS = 7

export interface WeeklyProgress {
  /** An i18n key, never prose — same discipline as the coach lines. */
  key: string
  params: { count: number; days: number }
}

/** Every line this module can emit — asserted against the message files. */
export const PROGRESS_LINE_KEYS = ['me.progress.A', 'me.progress.B', 'me.progress.C'] as const

/**
 * Ties break A > B > C, the same priority the winner rule itself uses: a week
 * split evenly between "听不清" and "没说完" is a week about being heard, because
 * the finished thought is worth nothing while the words are not landing (D1).
 */
const PRIORITY = ['A', 'B', 'C'] as const satisfies readonly WinnerType[]

/**
 * The one sentence `/me` shows, from the most recent ≤7 completions.
 *
 * @param winnerTypes most recent FIRST; entries without a winner (a day that
 *   only ever reached FAILED, say) are ignored rather than counted as a zero.
 * @returns `null` when there is nothing to say yet — the caller shows the
 *   "practise a few days" line instead of an empty template with a 0 in it.
 */
export function weeklyProgress(
  winnerTypes: readonly (WinnerType | null | undefined)[],
  windowDays: number = PROGRESS_WINDOW_DAYS,
): WeeklyProgress | null {
  const recent = winnerTypes
    .filter((type): type is WinnerType => type === 'A' || type === 'B' || type === 'C')
    .slice(0, windowDays)

  if (recent.length === 0) return null

  const counts = new Map<WinnerType, number>(PRIORITY.map((type) => [type, 0]))
  for (const type of recent) counts.set(type, (counts.get(type) ?? 0) + 1)

  // PRIORITY order + strict `>` means the first of a tie wins, which is the
  // A > B > C rule above stated once instead of as a comparator special case.
  let leader: WinnerType = 'A'
  for (const type of PRIORITY) {
    if ((counts.get(type) ?? 0) > (counts.get(leader) ?? 0)) leader = type
  }

  return {
    key: `me.progress.${leader}`,
    params: { count: counts.get(leader) ?? 0, days: windowDays },
  }
}
