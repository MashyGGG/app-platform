/**
 * How long a recording lives (IMPL §4.3 / §7 风险 3).
 *
 * Vercel Blob's Hobby tier is 1 GB. A 90-second 16 kHz WAV is ~2.9 MB, so the
 * store holds ~340 takes — and the product writes up to two a day per student
 * (首说 + 再试). Seven days × 30 students × 2 takes ≈ 1.2 GB, which is over the
 * line already; that is exactly why IMPL §4.4 红线 4 caps 日活 at 20.
 *
 * So retention is not housekeeping here, it is a capacity invariant, and it is
 * set at seven days because that is the window `/me` renders. Audio older than
 * the week view is audio nothing can play.
 *
 * The pruned SESSION survives — only `audioKey` / `retryAudioKey` are cleared.
 * 原则 E ("每次练习一条有主键的记录") is about the record, not the bytes.
 */

export const DEFAULT_RETENTION_DAYS = 7

/**
 * What retention shrinks to when the store is nearly full. Three days still
 * covers "yesterday and the day before", which is as far back as a student ever
 * clicks; the week view keeps rendering, just without playback on its older
 * days (IMPL §7: 「容量埋点，逼近上限自动缩到 3 天」).
 */
export const TIGHT_RETENTION_DAYS = 3

/** The fill level at which that happens. */
export const CAPACITY_PRESSURE_RATIO = 0.8

export interface RetentionInput {
  retentionDays: number
  /** Null when the store cannot report a size — the local filesystem, in dev. */
  usage: { usedBytes: number; capacityBytes: number } | null
  tightDays?: number
  pressureRatio?: number
}

/**
 * The window this prune run should actually apply.
 *
 * Deliberately one-way: pressure can only SHORTEN retention, never lengthen it
 * past what the deployment configured. An empty store is not an argument for
 * keeping audio longer than the week view can use.
 */
export function effectiveRetentionDays(input: RetentionInput): number {
  const tight = input.tightDays ?? TIGHT_RETENTION_DAYS
  const ratio = input.pressureRatio ?? CAPACITY_PRESSURE_RATIO

  if (!input.usage || input.usage.capacityBytes <= 0) return input.retentionDays
  if (input.usage.usedBytes / input.usage.capacityBytes < ratio) return input.retentionDays

  return Math.min(input.retentionDays, tight)
}

/**
 * Recordings that STARTED before this instant are prunable.
 *
 * Whole days would be tidier but wrong at the boundary: a run at 09:00 must not
 * delete audio a student recorded at 23:00 seven nights ago and can still see on
 * today's week strip.
 */
export function pruneCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - Math.max(0, retentionDays) * 24 * 60 * 60 * 1000)
}
