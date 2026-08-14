import 'server-only'
import { Prisma, prisma } from '@app/db'
import {
  NO_REPEAT_DAYS,
  dayIndexFromDateKey,
  pickPromptForDay,
  toDateKey,
  type PromptMaterial,
  type RetryItem,
  type WinnerResult,
} from '@app/shared/speaking'
import { audioLimits } from './config'
import { audioUrl } from './audio-store'

/**
 * "今日一题" — the one thing `/today` renders, and the session it belongs to.
 *
 * Both the page (a Server Component) and `POST /api/speaking/sessions` go
 * through `getOrCreateTodaySession`, so AC-I2 holds no matter which door the
 * user came in by.
 */

export interface TodayPromptView {
  id: string
  text: string
  warmupSentence: string
  modelAudioUrl: string | null
  checklist: string[]
}

export interface RetryItemView {
  kind: RetryItem['kind']
  text: string
  ipa?: string
  audioUrl: string | null
}

export interface TodaySessionView {
  id: string
  status: string
  winnerType: 'A' | 'B' | 'C' | null
  coachLineKey: string | null
  coachLineParams: Record<string, string | number>
  retryItems: RetryItemView[]
  retryState: 'PENDING' | 'DONE' | 'SKIPPED'
  degradedFlag: boolean
}

export interface TodayView {
  dateKey: string
  prompt: TodayPromptView
  session: TodaySessionView
  limits: { minDurationMs: number; maxDurationMs: number; sampleRate: number }
}

/** Persisted in `SpeakingSession.winnerPayload` — what P3 actually rendered. */
interface StoredWinnerPayload {
  coachLineKey: string
  coachLineParams: Record<string, string | number>
  retryItems: RetryItem[]
}

const promptSelect = {
  id: true,
  text: true,
  warmupSentence: true,
  modelAudioKey: true,
  checklist: true,
} satisfies Prisma.SpeakingPromptSelect

const sessionSelect = {
  id: true,
  status: true,
  winnerType: true,
  winnerPayload: true,
  retryState: true,
  degradedFlag: true,
  prompt: { select: promptSelect },
} satisfies Prisma.SpeakingSessionSelect

type SessionRow = Prisma.SpeakingSessionGetPayload<{ select: typeof sessionSelect }>

function asStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function readWinnerPayload(value: Prisma.JsonValue | null): StoredWinnerPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  if (typeof payload.coachLineKey !== 'string') return null
  return {
    coachLineKey: payload.coachLineKey,
    coachLineParams: (payload.coachLineParams ?? {}) as Record<string, string | number>,
    retryItems: Array.isArray(payload.retryItems) ? (payload.retryItems as RetryItem[]) : [],
  }
}

/** Storage keys never reach the client; the player gets a URL it may fetch. */
function toRetryItemView(item: RetryItem): RetryItemView {
  return {
    kind: item.kind,
    text: item.text,
    ...(item.kind === 'word' ? { ipa: item.ipa } : {}),
    audioUrl: audioUrl(item.audioKey),
  }
}

function toView(row: SessionRow, dateKey: string): TodayView {
  const payload = readWinnerPayload(row.winnerPayload)
  const limits = audioLimits()

  return {
    dateKey,
    prompt: {
      id: row.prompt.id,
      text: row.prompt.text,
      warmupSentence: row.prompt.warmupSentence,
      modelAudioUrl: audioUrl(row.prompt.modelAudioKey),
      checklist: asStringArray(row.prompt.checklist),
    },
    session: {
      id: row.id,
      status: row.status,
      winnerType: row.winnerType,
      coachLineKey: payload?.coachLineKey ?? null,
      coachLineParams: payload?.coachLineParams ?? {},
      retryItems: (payload?.retryItems ?? []).map(toRetryItemView),
      retryState: row.retryState,
      degradedFlag: row.degradedFlag,
    },
    limits: { ...limits, sampleRate: 16_000 },
  }
}

/**
 * Today's session for this user, created on first sight and returned unchanged
 * afterwards (AC-I2).
 *
 * The idempotency is the `@@unique([userId, dateKey])` constraint, not the
 * lookup: two requests racing on the first visit of the day would both miss the
 * read, and only one can win the insert. The loser reads the winner's row.
 */
export async function getOrCreateTodaySession(
  userId: string,
  now = new Date(),
): Promise<TodayView> {
  const dateKey = toDateKey(now)

  const existing = await prisma.speakingSession.findUnique({
    where: { userId_dateKey: { userId, dateKey } },
    select: sessionSelect,
  })
  if (existing) return toView(existing, dateKey)

  const promptId = await pickPromptId(userId, dateKey)

  try {
    const created = await prisma.speakingSession.create({
      data: { userId, promptId, dateKey, status: 'NOT_STARTED' },
      select: sessionSelect,
    })
    return toView(created, dateKey)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.speakingSession.findUniqueOrThrow({
        where: { userId_dateKey: { userId, dateKey } },
        select: sessionSelect,
      })
      return toView(winner, dateKey)
    }
    throw error
  }
}

/** `dayIndex % N` + the per-user 7-day no-repeat window (SPEC §5.1, AC-I4). */
async function pickPromptId(userId: string, dateKey: string): Promise<string> {
  const active = await prisma.speakingPrompt.findMany({
    where: { isActive: true },
    // A STABLE ring: the rotation is `dayIndex % N`, so a wobbling order would
    // silently reshuffle which day serves which prompt.
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  if (active.length === 0) {
    throw new Error('no active SpeakingPrompt — run `pnpm speaking:seed`')
  }

  const recent = await prisma.speakingSession.findMany({
    where: { userId },
    orderBy: { dateKey: 'desc' },
    take: NO_REPEAT_DAYS,
    select: { promptId: true },
  })

  const picked = pickPromptForDay({
    promptIds: active.map((prompt) => prompt.id),
    dayIndex: dayIndexFromDateKey(dateKey),
    recentPromptIds: recent.map((session) => session.promptId),
  })
  // `active` is non-empty, so pickPromptForDay cannot return null here.
  return picked as string
}

/** Everything the winner rule needs about a prompt, in one read. */
export async function loadPromptMaterial(promptId: string): Promise<PromptMaterial> {
  const prompt = await prisma.speakingPrompt.findUniqueOrThrow({
    where: { id: promptId },
    select: {
      checklist: true,
      words: {
        orderBy: { sort: 'asc' },
        select: { word: { select: { lemma: true, ipa: true, audioKey: true } } },
      },
      sentences: {
        where: { kind: 'paraphrase' },
        orderBy: { sort: 'asc' },
        select: { text: true, audioKey: true },
      },
    },
  })

  return {
    checklist: asStringArray(prompt.checklist),
    words: prompt.words.map(({ word }) => ({
      lemma: word.lemma,
      ipa: word.ipa,
      audioKey: word.audioKey,
    })),
    paraphrases: prompt.sentences.map((sentence) => ({
      text: sentence.text,
      audioKey: sentence.audioKey,
    })),
  }
}

export type WinnerView = Pick<
  TodaySessionView,
  'winnerType' | 'coachLineKey' | 'coachLineParams' | 'retryItems'
>

/** The client-facing half of a scoring result — keys in, URLs out. */
export function toWinnerView(result: WinnerResult): WinnerView {
  return {
    winnerType: result.winnerType,
    coachLineKey: result.coachLineKey,
    coachLineParams: result.coachLineParams,
    retryItems: result.retryItems.map(toRetryItemView),
  }
}
