/**
 * The winner rule — "系统只挑一个赢家" (SPEC §4.1, AC-S3).
 *
 * | 类型 | 何时判为它   | 当屏动作            |
 * | A    | 听不清       | 再读 ≤3 个词        |
 * | B    | 在背稿       | 给一句换说法再说一遍 |
 * | C    | 没说完       | 提示补一句再结束     |
 *
 * Priority is **A > B > C** and it is not a tie-break, it is a claim: correcting
 * word choice is pointless while the listener still cannot make the words out
 * (D1). The UI renders the winner and nothing else.
 *
 * Rules, not an LLM (IMPL §8-Q3). That is why this file is pure and why the
 * thresholds are exported constants — every boundary below is a Vitest row, and
 * AC-S8's "日志无 LLM 调用" holds by construction rather than by inspection.
 */
import type { AsrWord } from './speech'

/** Below this ASR/pronunciation confidence a word becomes a winner-A candidate. */
export const MIN_WORD_CONFIDENCE = 0.6
/** SPEC §4.1: winner A hands back at most three words. */
export const MAX_RETRY_WORDS = 3
/**
 * unique words ÷ total words. Real 30–90 s answers sit well above this; a
 * memorised loop ("it is very good because it is very good") falls under it.
 */
export const MIN_TYPE_TOKEN_RATIO = 0.45
/** Below this the ratio is noise, not a signal — too few words to judge repetition. */
export const MIN_TOKENS_FOR_RATIO = 25

/** Discourse markers stand in for "有理由 / 有例子" — the checklist is a Chinese
 * operator hint and cannot be keyword-matched against an English answer. */
export const REASON_MARKERS = [
  'because',
  'since',
  'so that',
  "that's why",
  'thats why',
  'the reason',
  'due to',
] as const
export const EXAMPLE_MARKERS = [
  'for example',
  'for instance',
  'such as',
  'like when',
  'last time',
  'last week',
  'last month',
  'once i',
] as const

export type WinnerType = 'A' | 'B' | 'C'

export interface PromptMaterial {
  /** 理由 / 例子 hints, shown verbatim when C wins (SPEC §5.1). */
  checklist: readonly string[]
  /** Pre-attached error-prone words — winner A's primary candidates. */
  words: readonly { lemma: string; ipa: string; audioKey: string | null }[]
  /** 换说法 material — winner B's action. At least one exists (AC-I1). */
  paraphrases: readonly { text: string; audioKey: string | null }[]
}

export interface WinnerInput {
  transcript: string
  words: readonly AsrWord[]
  durationMs: number
  prompt: PromptMaterial
}

export type RetryItem =
  | { kind: 'word'; text: string; ipa: string; audioKey: string | null }
  | { kind: 'sentence'; text: string; audioKey: string | null }
  | { kind: 'checklist'; text: string; audioKey: null }

export interface WinnerResult {
  winnerType: WinnerType
  /**
   * An i18n key, never prose: the server ships keys and the client translates,
   * the same discipline the error envelope follows.
   */
  coachLineKey: string
  coachLineParams: Record<string, string | number>
  retryItems: RetryItem[]
}

export function tokenize(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .split(/\s+/)
    .map((raw) => raw.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean)
}

export function typeTokenRatio(tokens: readonly string[]): number {
  if (tokens.length === 0) return 1
  return new Set(tokens).size / tokens.length
}

function hasAny(transcript: string, markers: readonly string[]): boolean {
  const haystack = transcript.toLowerCase()
  return markers.some((marker) => haystack.includes(marker))
}

/**
 * Winner-A candidates, best material first: a pre-attached lemma arrives with an
 * IPA and a recorded 示范音, an ASR word does not. Falling back to the worst ASR
 * words is SPEC §5.3's second tier — those carry `audioKey: null` until the M5
 * TTS fallback fills them in.
 */
function unclearWords(input: WinnerInput): RetryItem[] {
  const weak = input.words
    .filter((word) => word.confidence < MIN_WORD_CONFIDENCE)
    .sort((a, b) => a.confidence - b.confidence)

  const attached = new Map(input.prompt.words.map((word) => [word.lemma.toLowerCase(), word]))
  const picked: RetryItem[] = []
  const seen = new Set<string>()

  for (const pass of ['attached', 'asr'] as const) {
    for (const word of weak) {
      if (picked.length >= MAX_RETRY_WORDS) break
      const hit = attached.get(word.word)
      if (pass === 'attached' ? !hit : Boolean(hit)) continue
      if (seen.has(word.word)) continue
      seen.add(word.word)
      picked.push({
        kind: 'word',
        text: hit?.lemma ?? word.word,
        ipa: hit?.ipa ?? '',
        audioKey: hit?.audioKey ?? null,
      })
    }
  }

  return picked
}

/**
 * Picks exactly one winner. Never returns "nothing to work on": C's action —
 * add one more sentence and stop — is always available and always harmless, so
 * it is also the floor when no rule trips. A session that ends with no next step
 * would break the core loop (D1).
 */
export function pickWinner(input: WinnerInput): WinnerResult {
  const tokens = tokenize(input.transcript)

  const unclear = unclearWords(input)
  if (unclear.length > 0) {
    return {
      winnerType: 'A',
      coachLineKey: 'today.coach.A',
      coachLineParams: { count: unclear.length },
      retryItems: unclear,
    }
  }

  const ratio = typeTokenRatio(tokens)
  const paraphrase = input.prompt.paraphrases[0]
  if (tokens.length >= MIN_TOKENS_FOR_RATIO && ratio < MIN_TYPE_TOKEN_RATIO && paraphrase) {
    return {
      winnerType: 'B',
      coachLineKey: 'today.coach.B',
      coachLineParams: {},
      retryItems: [
        { kind: 'sentence', text: paraphrase.text, audioKey: paraphrase.audioKey ?? null },
      ],
    }
  }

  // The hint that matches what is actually missing: checklist[1] is the "理由"
  // line and checklist[2] the "例子" line by import convention, but a prompt may
  // carry only two, so every lookup falls back to the last entry.
  const [coachLineKey, hintIndex] = !hasAny(input.transcript, REASON_MARKERS)
    ? (['today.coach.C_reason', 1] as const)
    : !hasAny(input.transcript, EXAMPLE_MARKERS)
      ? (['today.coach.C_example', 2] as const)
      : // Nothing tripped at all. C is still the answer — a session that ends
        // with no next step breaks the core loop — but the line has to admit
        // that the answer was fine rather than ask for a reason already given.
        (['today.coach.C_more', 2] as const)

  const hint = input.prompt.checklist[hintIndex] ?? input.prompt.checklist.at(-1)

  return {
    winnerType: 'C',
    coachLineKey,
    coachLineParams: {},
    retryItems: hint ? [{ kind: 'checklist', text: hint, audioKey: null }] : [],
  }
}

/** Every coach line this module can emit — asserted against the message files. */
export const COACH_LINE_KEYS = [
  'today.coach.A',
  'today.coach.B',
  'today.coach.C_reason',
  'today.coach.C_example',
  'today.coach.C_more',
] as const
