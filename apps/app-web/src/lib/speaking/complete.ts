import 'server-only'
import { Prisma, prisma } from '@app/db'
import type { SpeakingRetryState } from '@app/db'

/**
 * 收工 — P4 (SPEC §5.1: "完成条件：再试成功 **或** 跳过再试 → COMPLETED，写
 * `daily_completion(date, session_id, winner_type, retry_state)`", AC-S5).
 *
 * Two doors, one function: `/retry` and `/skip-retry` differ only in what they
 * did with the microphone first. Both then close the day the same way, and that
 * "same way" has to be one place — a completion written by one route and not the
 * other is how `/me` ends up disagreeing with `/today`.
 */

export type CompletionOutcome = 'DONE' | 'SKIPPED'

export interface CompletableSession {
  id: string
  userId: string
  promptId: string
  dateKey: string
  status: string
  winnerType: 'A' | 'B' | 'C' | null
  retryState: SpeakingRetryState
}

const completableSelect = {
  id: true,
  userId: true,
  promptId: true,
  dateKey: true,
  status: true,
  winnerType: true,
  retryState: true,
} satisfies Prisma.SpeakingSessionSelect

/**
 * The session this user may complete, or `null` — deliberately the same answer
 * for "no such id" and "someone else's id", because a 403 would confirm the id
 * exists (the same reasoning as the upload route).
 */
export async function findOwnSession(
  sessionId: string,
  userId: string,
): Promise<CompletableSession | null> {
  const session = await prisma.speakingSession.findUnique({
    where: { id: sessionId },
    select: completableSelect,
  })
  if (!session || session.userId !== userId) return null
  return session
}

/** A day can only be closed once it has a next step to have acted on. */
export function isScored(session: CompletableSession): boolean {
  return session.winnerType !== null
}

/**
 * …with one exception, and AC-S10 is it: 「用户可选跳过直接 COMPLETED」.
 *
 * A DEGRADED session has no winner precisely because the scoring never came
 * back, and refusing to close it would strand the student in the one place the
 * criterion forbids — 「不得让用户处于无提示的无限等待」. The completion row it
 * writes carries `winner_type: null`, which the weekly template already counts
 * as a practised-but-unclassified day rather than as an A/B/C.
 *
 * Only the SKIP door takes this route. `/retry` still demands a score, because a
 * retry take is a re-recording OF a next step the student never received.
 */
export function isCompletable(session: CompletableSession): boolean {
  return isScored(session) || session.status === 'DEGRADED'
}

/** `SpeakingDailyCompletion.date` is a DATE, and `dateKey` is already the day. */
function dateOf(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`)
}

/**
 * Marks the day done, idempotently.
 *
 * The session update and the completion row go in one transaction: a COMPLETED
 * session with no `SpeakingDailyCompletion` would show "今天练完了" on `/today`
 * and an empty cell on `/me` for the same day, and nothing would ever repair it.
 *
 * Re-entrancy is real, not theoretical — a double-tapped 跳过 button sends two
 * requests. The `upsert` on the unique `sessionId` absorbs the second, and the
 * `retryState` a completed session already carries is not overwritten: having
 * spoken the retry and then pressed skip, the day was 完成 by DONE.
 */
export async function completeSession(
  session: CompletableSession,
  outcome: CompletionOutcome,
  retryAudioKey?: string,
): Promise<void> {
  const settled = session.retryState === 'DONE' ? 'DONE' : outcome

  await prisma.$transaction([
    prisma.speakingSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        retryState: settled,
        completedAt: new Date(),
        ...(retryAudioKey ? { retryAudioKey } : {}),
      },
    }),
    prisma.speakingDailyCompletion.upsert({
      where: { sessionId: session.id },
      create: {
        userId: session.userId,
        date: dateOf(session.dateKey),
        sessionId: session.id,
        winnerType: session.winnerType,
        retryState: settled,
      },
      update: { retryState: settled },
    }),
  ])
}
