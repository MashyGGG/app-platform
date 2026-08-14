import { describe, expect, it } from 'vitest'
import { PROGRESS_LINE_KEYS, PROGRESS_WINDOW_DAYS, weeklyProgress } from './progress'
import type { WinnerType } from './winner'

/**
 * AC-S8 lives here rather than in the e2e suite for one practical reason: the
 * criterion is stated over **seven days of history** ("构造 4A/2B/1C"), and a
 * black-box test cannot make seven calendar days happen — one account gets one
 * session per day, by the constraint AC-I2 rests on. So Playwright asserts that
 * `/me` renders a real template line, and the counting rule the line comes from
 * is a table right here (IMPL §4.6).
 */

/** Spelt out as a string so a row reads like the week it describes. */
function week(pattern: string): WinnerType[] {
  return [...pattern] as WinnerType[]
}

describe('weeklyProgress', () => {
  it('AC-S8: 4A / 2B / 1C says 把话说清, four times', () => {
    expect(weeklyProgress(week('AAAABBC'))).toEqual({
      key: 'me.progress.A',
      params: { count: 4, days: 7 },
    })
  })

  it.each([
    ['AAAABBC', 'me.progress.A', 4],
    ['BBBAAC', 'me.progress.B', 3],
    ['CCCAB', 'me.progress.C', 3],
    ['A', 'me.progress.A', 1],
    ['CCB', 'me.progress.C', 2],
  ])('%s → %s (%i)', (pattern, key, count) => {
    expect(weeklyProgress(week(pattern))).toEqual({ key, params: { count, days: 7 } })
  })

  it.each([
    // Ties break A > B > C — the winner rule's own priority, not insertion order.
    ['ABAB', 'me.progress.A'],
    ['BCBC', 'me.progress.B'],
    ['CBA', 'me.progress.A'],
    ['CB', 'me.progress.B'],
  ])('%s breaks the tie as %s', (pattern, key) => {
    expect(weeklyProgress(week(pattern))?.key).toBe(key)
  })

  it('says nothing at all before the first completion', () => {
    // A template with a zero in it ("这周你主要在练把话说清（7 天里 0 次）") is worse
    // than no sentence: it claims a pattern from no data.
    expect(weeklyProgress([])).toBeNull()
    expect(weeklyProgress([null, undefined])).toBeNull()
  })

  it('ignores days that never produced a winner', () => {
    // FAILED and DEGRADED days leave a session behind with no winner_type. They
    // are absent from the count, not a fourth category.
    expect(weeklyProgress([null, 'B', undefined, 'B', 'A'])).toEqual({
      key: 'me.progress.B',
      params: { count: 2, days: 7 },
    })
  })

  it('counts at most seven, most recent first', () => {
    // Eight days of history, and the eighth is the only C. "最近 ≤7 条" means the
    // oldest entry falls out of the window rather than tipping the sentence.
    const eight = week('AAABBBB').concat('C')
    expect(weeklyProgress(eight)).toEqual({
      key: 'me.progress.B',
      params: { count: 4, days: 7 },
    })
    expect(eight.length).toBeGreaterThan(PROGRESS_WINDOW_DAYS)
  })

  it('can only emit a key that is declared', () => {
    // The message-file contract test iterates PROGRESS_LINE_KEYS; a key produced
    // here but missing from that list would ship as a raw `me.progress.X`.
    const keys = new Set(PROGRESS_LINE_KEYS as readonly string[])
    for (const pattern of ['A', 'B', 'C', 'AAB', 'BBC', 'CCA']) {
      expect(keys).toContain(weeklyProgress(week(pattern))?.key)
    }
  })
})
