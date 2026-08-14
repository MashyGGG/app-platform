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

  await prisma.speakingSession.update({
    where: { id: input.sessionId },
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

  await prisma.speakingSession.update({
    where: { id: input.sessionId },
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
 * `SpeakingDailyCompletion` row is written.
 */
export async function markSessionFailed(sessionId: string): Promise<void> {
  await prisma.speakingSession.update({ where: { id: sessionId }, data: { status: 'FAILED' } })
}
