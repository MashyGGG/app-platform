import { describe, expect, it } from 'vitest'
import { NO_REPEAT_DAYS, dayIndexFromDateKey, pickPromptForDay, toDateKey } from './rotation'

/**
 * AC-I4: "THE 导入 SHALL 支持一次导入 ≥21 道合格题，并使随后 21 个日历日均能出题."
 * 测法 = 种子 + 日期模拟 — which is exactly what a pure rotation function lets
 * us do here in milliseconds; E2E cannot travel 21 days.
 */
const ring = (count: number) => Array.from({ length: count }, (_, i) => `p-${i}`)

/** Replays N consecutive days the way the route will: pick, then remember. */
function simulate(promptIds: readonly string[], days: number, startDayIndex = 0) {
  const served: string[] = []
  for (let day = 0; day < days; day += 1) {
    const picked = pickPromptForDay({
      promptIds,
      dayIndex: startDayIndex + day,
      recentPromptIds: served.slice(-NO_REPEAT_DAYS),
    })
    if (picked === null) throw new Error(`no prompt on day ${day}`)
    served.push(picked)
  }
  return served
}

describe('pickPromptForDay', () => {
  it('serves a prompt on each of 21 consecutive days from a 21-prompt ring', () => {
    const served = simulate(ring(21), 21)
    expect(served).toHaveLength(21)
    expect(new Set(served).size).toBe(21)
  })

  it('never repeats within any 7-day window over a 60-day run', () => {
    const served = simulate(ring(21), 60)
    for (let start = 0; start + NO_REPEAT_DAYS <= served.length; start += 1) {
      const window = served.slice(start, start + NO_REPEAT_DAYS)
      expect(new Set(window).size).toBe(NO_REPEAT_DAYS)
    }
  })

  it('follows dayIndex % N when the user has no history', () => {
    const promptIds = ring(21)
    expect(pickPromptForDay({ promptIds, dayIndex: 0 })).toBe('p-0')
    expect(pickPromptForDay({ promptIds, dayIndex: 22 })).toBe('p-1')
  })

  it('walks forward past a prompt the user already saw this week', () => {
    const promptIds = ring(21)
    expect(pickPromptForDay({ promptIds, dayIndex: 3, recentPromptIds: ['p-3'] })).toBe('p-4')
    expect(pickPromptForDay({ promptIds, dayIndex: 3, recentPromptIds: ['p-3', 'p-4'] })).toBe(
      'p-5',
    )
  })

  it('wraps around the end of the ring rather than running off it', () => {
    const promptIds = ring(3)
    expect(pickPromptForDay({ promptIds, dayIndex: 2, recentPromptIds: ['p-2'] })).toBe('p-0')
  })

  it('serves a repeat rather than nothing when every prompt is recent', () => {
    // Only reachable below eight active prompts. A day with no prompt is a dead
    // app; a repeat is merely a worse day.
    const promptIds = ring(3)
    expect(pickPromptForDay({ promptIds, dayIndex: 1, recentPromptIds: promptIds })).toBe('p-1')
  })

  it('returns null only when no prompt is active at all', () => {
    expect(pickPromptForDay({ promptIds: [], dayIndex: 5 })).toBeNull()
  })

  it('handles a negative dayIndex without throwing or picking off-ring', () => {
    // Date.parse of a pre-1970 key is legal input; JS `%` would return -1 here.
    expect(pickPromptForDay({ promptIds: ring(21), dayIndex: -1 })).toBe('p-20')
  })
})

describe('toDateKey / dayIndexFromDateKey', () => {
  it('rolls the day over at local midnight, not UTC midnight', () => {
    // 2026-08-14T16:30Z is already 2026-08-15 in UTC+8. Getting this wrong
    // would let a student "complete today" twice across the 00:00–08:00 window,
    // silently breaking the AC-I2 idempotency key.
    expect(toDateKey(new Date('2026-08-14T16:30:00.000Z'))).toBe('2026-08-15')
    expect(toDateKey(new Date('2026-08-14T15:59:00.000Z'))).toBe('2026-08-14')
  })

  it('honours an explicit offset', () => {
    expect(toDateKey(new Date('2026-08-14T16:30:00.000Z'), 0)).toBe('2026-08-14')
  })

  it('advances the day index by exactly one per calendar day', () => {
    expect(dayIndexFromDateKey('2026-08-15') - dayIndexFromDateKey('2026-08-14')).toBe(1)
    // Across a month boundary, where naive date arithmetic breaks.
    expect(dayIndexFromDateKey('2026-09-01') - dayIndexFromDateKey('2026-08-31')).toBe(1)
  })

  it('is stable for the epoch and rejects a malformed key', () => {
    expect(dayIndexFromDateKey('1970-01-01')).toBe(0)
    expect(() => dayIndexFromDateKey('not-a-date')).toThrow(/invalid date key/)
  })
})
