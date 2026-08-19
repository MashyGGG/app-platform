/**
 * Daily prompt rotation (SPEC §5.1: `dayIndex % N` + "最近 7 天不重复", AC-I4).
 *
 * Pure and DB-free on purpose — the route hands in the active prompt ids and
 * the user's recent history, so the rule itself is table-testable.
 */

/** The per-user look-back window that must not repeat a prompt. */
export const NO_REPEAT_DAYS = 7

/**
 * A calendar day key (`YYYY-MM-DD`) for the given instant in a fixed offset.
 *
 * The MVP has one audience and one timezone, so the offset is a parameter with
 * a China-Standard-Time default rather than a per-user setting. It matters
 * because `SpeakingDailyCompletion.date` is a DATE: "today" must not flip at
 * 08:00 local just because the server thinks in UTC.
 */
export function toDateKey(at: Date, offsetMinutes = 8 * 60): string {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000)
  return shifted.toISOString().slice(0, 10)
}

/** Whole days since 1970-01-01 for a `YYYY-MM-DD` key — the rotation cursor. */
export function dayIndexFromDateKey(dateKey: string): number {
  const parsed = Date.parse(`${dateKey}T00:00:00.000Z`)
  if (Number.isNaN(parsed)) throw new Error(`invalid date key: ${dateKey}`)
  return Math.floor(parsed / 86_400_000)
}

export type PickPromptParams = {
  /** Active prompt ids in a STABLE order (sort, then id) — the rotation ring. */
  promptIds: readonly string[]
  /** Whole days since epoch; see `dayIndexFromDateKey`. */
  dayIndex: number
  /** Prompt ids this user saw in the last `NO_REPEAT_DAYS` days. */
  recentPromptIds?: readonly string[]
}

/**
 * Picks today's prompt: start at `dayIndex % N`, then walk the ring forward to
 * the first prompt the user has not seen recently.
 *
 * Falls back to the unshifted `dayIndex % N` slot when every prompt is recent
 * (only reachable with fewer than eight active prompts). Serving a repeat beats
 * serving nothing — a day with no prompt is a dead app, and AC-I4's guarantee
 * is "every calendar day gets a prompt".
 */
export function pickPromptForDay({
  promptIds,
  dayIndex,
  recentPromptIds = [],
}: PickPromptParams): string | null {
  const total = promptIds.length
  if (total === 0) return null

  const start = ((dayIndex % total) + total) % total
  const recent = new Set(recentPromptIds)

  for (let step = 0; step < total; step += 1) {
    const candidate = promptIds[(start + step) % total] as string
    if (!recent.has(candidate)) return candidate
  }

  return promptIds[start] as string
}
