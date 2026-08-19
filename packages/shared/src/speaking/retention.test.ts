import { describe, expect, it } from 'vitest'
import {
  CAPACITY_PRESSURE_RATIO,
  DEFAULT_RETENTION_DAYS,
  TIGHT_RETENTION_DAYS,
  effectiveRetentionDays,
  pruneCutoff,
} from './retention'

const GB = 1024 * 1024 * 1024

/**
 * The arithmetic that keeps the free tier from filling up (IMPL §4.4 红线 3).
 *
 * Boundary-heavy on purpose: every row here is a decision about deleting a
 * student's recording, and the one direction this function must never move in
 * — lengthening retention because the store happens to be empty — has no other
 * place it can be asserted.
 */
describe('effectiveRetentionDays', () => {
  it('leaves retention alone below the pressure line', () => {
    expect(
      effectiveRetentionDays({
        retentionDays: DEFAULT_RETENTION_DAYS,
        usage: { usedBytes: 0.5 * GB, capacityBytes: GB },
      }),
    ).toBe(7)
  })

  it('tightens to three days once the store is 80% full', () => {
    expect(
      effectiveRetentionDays({
        retentionDays: DEFAULT_RETENTION_DAYS,
        usage: { usedBytes: CAPACITY_PRESSURE_RATIO * GB, capacityBytes: GB },
      }),
    ).toBe(TIGHT_RETENTION_DAYS)
  })

  it('never LENGTHENS retention — an empty store is not a reason to keep more', () => {
    expect(
      effectiveRetentionDays({ retentionDays: 2, usage: { usedBytes: 0, capacityBytes: GB } }),
    ).toBe(2)
    // …and pressure cannot push a 2-day policy back up to the 3-day floor either.
    expect(
      effectiveRetentionDays({ retentionDays: 2, usage: { usedBytes: GB, capacityBytes: GB } }),
    ).toBe(2)
  })

  it('keeps the configured window when the store cannot report a size', () => {
    // The local filesystem, in dev: no ceiling worth measuring, so no pressure.
    expect(effectiveRetentionDays({ retentionDays: 7, usage: null })).toBe(7)
    expect(
      effectiveRetentionDays({ retentionDays: 7, usage: { usedBytes: 10, capacityBytes: 0 } }),
    ).toBe(7)
  })
})

describe('pruneCutoff', () => {
  it('counts back exactly N×24h, not N calendar days', () => {
    // A run at 09:00 must not delete audio recorded at 23:00 seven nights ago:
    // it is still on today's week strip, and the student can still press play.
    const now = new Date('2026-08-19T09:00:00.000Z')
    expect(pruneCutoff(now, 7).toISOString()).toBe('2026-08-12T09:00:00.000Z')
  })

  it('prunes everything when the window is zero', () => {
    const now = new Date('2026-08-19T09:00:00.000Z')
    expect(pruneCutoff(now, 0).getTime()).toBe(now.getTime())
    expect(pruneCutoff(now, -3).getTime()).toBe(now.getTime())
  })
})
