import 'server-only'
import { prisma } from '@app/db'
import { getSpeechProvider } from './provider'

/**
 * P1 热身拍 (AC-S7) — "播放示范并接受一句跟读，且跳过热身不影响进入主开口".
 *
 * This is the one place in the product that uses the phoneme mode with a
 * REFERENCE TEXT, which 原则 B calls non-negotiable: free-speech pronunciation
 * scoring is unreliable, so the warm-up — where the sentence is known — is
 * exactly the shape that mode was kept for.
 *
 * The take is assessed and DISCARDED, never stored, and that is a budget
 * decision rather than an oversight: IMPL §4.4 红线 3 sizes Vercel Blob's 1 GB
 * free tier at two takes a day (首说 + 再试) and is already 压线 at ~1.2 GB. A
 * third stored take per day would blow it by half, to keep audio no acceptance
 * criterion asks for and no screen ever plays back.
 */

export interface WarmupResult {
  referenceText: string
  /** 0–100 from the phoneme pass. Returned for observability, never shown: 热身不打分. */
  accuracy: number
}

export async function assessWarmupTake(input: {
  sessionId: string
  promptId: string
  audio: Uint8Array
}): Promise<WarmupResult> {
  const { warmupSentence } = await prisma.speakingPrompt.findUniqueOrThrow({
    where: { id: input.promptId },
    select: { warmupSentence: true },
  })

  const assessment = await getSpeechProvider().assess(input.audio, warmupSentence)

  // Only NOT_STARTED advances. A student who warmed up, spoke, and then came
  // back to read the sentence once more is in RETRY — and WARMUP is behind them
  // on the state machine, not ahead.
  await prisma.speakingSession.updateMany({
    where: { id: input.sessionId, status: 'NOT_STARTED' },
    data: { status: 'WARMUP' },
  })

  return { referenceText: warmupSentence, accuracy: assessment.accuracy }
}
