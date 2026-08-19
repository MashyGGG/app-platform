import 'server-only'
import { prisma } from '@app/db'
import { pickWinner, type WinnerResult } from '@app/shared/speaking'
import { getAudioStore, takeKey } from './audio-store'
import { loadPromptMaterial } from './today'
import { getSpeechProvider } from './provider'

/**
 * P2 提交 → P3 出现, synchronously (SPEC §4.3: 目标 8s / P95 15s).
 *
 * The order matters: store the audio first, then score. A take that scored but
 * was never stored is unrecoverable — the student cannot replay what they said —
 * whereas a take that stored but failed to score is exactly the FAILED branch
 * AC-S6 already covers, and the recording is still there for the retry.
 */
export interface ScoreResult {
  winner: WinnerResult
  transcript: string
  durationMs: number
}

export async function scoreMainTake(input: {
  userId: string
  sessionId: string
  promptId: string
  audio: Uint8Array
  durationMs: number
}): Promise<ScoreResult> {
  const key = takeKey(input.userId, input.sessionId, 'main')
  await getAudioStore().put(key, input.audio, 'audio/wav')

  // Guarded like the write at the end of this function, and for the same reason:
  // a take submitted before the student closed the day (AC-S10) can still be
  // mid-flight afterwards, and moving a COMPLETED session back to SCORING would
  // reopen a day `/today` has already shown as finished.
  await prisma.speakingSession.updateMany({
    where: { id: input.sessionId, status: { not: 'COMPLETED' } },
    data: { status: 'SCORING', audioKey: key, durationMs: input.durationMs },
  })

  const material = await loadPromptMaterial(input.promptId)
  const provider = getSpeechProvider()

  const { text, words } = await provider.transcribe(input.audio, {
    vocabulary: material.words.map((word) => word.lemma),
  })

  const winner = pickWinner({
    transcript: text,
    words,
    durationMs: input.durationMs,
    prompt: material,
  })

  // `updateMany` for the guard, not for the fan-out: AC-S10's slow path lets the
  // student close the day from the degraded prompt while this very request is
  // still running, and a score landing afterwards must not reopen a finished
  // day. The winner is still returned to the caller — the client drops it if it
  // has already moved on (see TodaySession's `abandoned` ref).
  await prisma.speakingSession.updateMany({
    where: { id: input.sessionId, status: { not: 'COMPLETED' } },
    data: {
      // RETRY, not COMPLETED: the day closes when the student re-records or
      // explicitly skips (AC-S5), which is M3's half of the loop.
      status: 'RETRY',
      transcript: text,
      winnerType: winner.winnerType,
      winnerPayload: {
        coachLineKey: winner.coachLineKey,
        coachLineParams: winner.coachLineParams,
        retryItems: winner.retryItems,
      },
    },
  })

  return { winner, transcript: text, durationMs: input.durationMs }
}

/**
 * AC-S6 — "IF 评分失败，THEN 保留今日题目并允许重录主开口，不得消耗当日完成资格."
 * FAILED is a side branch: the session and its prompt survive, and no
 * `SpeakingDailyCompletion` row is written. Nothing here resets `audioKey` or
 * `promptId`, so pressing record again simply overwrites the take.
 *
 * Guarded like the write above, for the same reason: a failure arriving after
 * the student finished the day must not un-finish it.
 */
export async function markSessionFailed(sessionId: string): Promise<void> {
  await prisma.speakingSession.updateMany({
    where: { id: sessionId, status: { not: 'COMPLETED' } },
    data: { status: 'FAILED' },
  })
}

/**
 * AC-S10 — the 20-second line was crossed and the request has NOT errored.
 *
 * Deliberately not merged with FAILED (SPEC §4.3): 弱网 misread as 失败 corrupts
 * the one signal that would tell us whether the scoring chain is too slow or
 * actually broken.
 *
 * Two writes, because they answer two different questions. `degradedFlag` is the
 * observability record — the day WAS slow, and that stays true however the day
 * ends, so it is set unconditionally.
 *
 * The status only moves while the student still has NOTHING to act on, which is
 * what DEGRADED means and what makes it a completable state (`isCompletable`).
 * RETRY is excluded because a score that landed in the same instant the timer
 * fired leaves a real next step on screen — the day is not stranded, so it must
 * not become skippable-without-a-winner. COMPLETED is excluded because it is
 * over. Everything before those two — including NOT_STARTED, if the request
 * stalled before it could even be marked SCORING — is a student waiting.
 */
export async function markSessionDegraded(sessionId: string): Promise<void> {
  await prisma.$transaction([
    prisma.speakingSession.update({ where: { id: sessionId }, data: { degradedFlag: true } }),
    prisma.speakingSession.updateMany({
      where: { id: sessionId, status: { notIn: ['COMPLETED', 'RETRY'] } },
      data: { status: 'DEGRADED' },
    }),
  ])
}
