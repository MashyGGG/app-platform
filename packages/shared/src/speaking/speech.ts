/**
 * One speech interface, two implementations (IMPL §4.2 — the key decision).
 *
 * There are no speech-vendor credentials in this repository, yet pre-commit, CI
 * and the e2e suite must all run. So the product talks to `SpeechProvider`, and
 * the default implementation is a DETERMINISTIC stub: the same audio always
 * yields the same result. That is what lets a black-box test assert AC-S3 at
 * all, and — per IMPL §4.4 — it doubles as the fallback running mode when the
 * Azure F0 free quota (5 audio hours/month) is spent.
 *
 * The real implementation lands in M5 behind this same interface.
 */

export interface AsrWord {
  word: string
  /** 0–1. Winner A's candidate set is drawn from the low end (SPEC §5.3). */
  confidence: number
}

export interface TranscribeResult {
  text: string
  words: AsrWord[]
}

export interface PhonemeScore {
  phoneme: string
  score: number
}

export interface AssessedWord {
  word: string
  score: number
  phonemes: PhonemeScore[]
}

export interface AssessResult {
  accuracy: number
  words: AssessedWord[]
}

export interface SpeechContext {
  /**
   * The prompt's pre-attached lemmas, handed to the recogniser as a bias list.
   * Real services support exactly this (Azure "phrase list", Google "speech
   * adaptation"), and it is also what gives winner A candidates that come with
   * an IPA and a recorded 示范音 rather than a bare red word.
   */
  vocabulary?: readonly string[]
}

export interface SpeechProvider {
  readonly name: string
  transcribe(audio: Uint8Array, context?: SpeechContext): Promise<TranscribeResult>
  /**
   * Pronunciation assessment WITH a reference text — the phoneme mode. 原则 B
   * makes this non-negotiable: free-speech scoring is far less reliable, so the
   * warm-up read-aloud and the winner-A re-read both go through here.
   */
  assess(audio: Uint8Array, referenceText: string): Promise<AssessResult>
}

// --- the deterministic stub --------------------------------------------------

/**
 * The three shapes a take can have, one per winner type. The stub picks one
 * from the audio bytes, so a given recording always scores the same way.
 */
export const STUB_SCENARIOS = ['unclear', 'scripted', 'incomplete'] as const
export type StubScenario = (typeof STUB_SCENARIOS)[number]

/** FNV-1a, 32-bit. Not a security hash — just a stable, dependency-free spread. */
export function fnv1a(bytes: Uint8Array): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i] as number
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function stubScenarioFor(audio: Uint8Array): StubScenario {
  return STUB_SCENARIOS[fnv1a(audio) % STUB_SCENARIOS.length] as StubScenario
}

/** Confidence the stub reports for a word it wants winner A to pick up. */
export const STUB_LOW_CONFIDENCE = 0.34
const STUB_HIGH_CONFIDENCE = 0.94

function words(text: string, confidenceOf: (word: string) => number): AsrWord[] {
  return text
    .split(/\s+/)
    .map((raw) => raw.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase())
    .filter(Boolean)
    .map((word) => ({ word, confidence: confidenceOf(word) }))
}

function scenarioTranscript(scenario: StubScenario, vocabulary: readonly string[]): string {
  const [first = 'weekend', second = 'plan', third = 'because'] = vocabulary

  switch (scenario) {
    // Plenty of content and structure — what fails is the pronunciation, so the
    // pre-attached lemmas come back with a poor confidence.
    case 'unclear':
      return (
        `I think the ${first} matters a lot to me because it changes how my week feels. ` +
        `My ${second} is simple and ${third} is the part I always keep. ` +
        `For example last month I tried it with a friend and we both liked the result.`
      )
    // Reads like a memorised script: correct, confident, and almost no distinct
    // vocabulary — a low type/token ratio is exactly what "在背稿" looks like.
    case 'scripted':
      return (
        `I think it is very good because it is very good for me. ` +
        `It is very good because I think it is very good. ` +
        `For example it is very good and I think it is very good for me every day.`
      )
    // Clear and varied, but stops at the opinion: no reason, no example.
    case 'incomplete':
      return `Honestly I would probably choose the second one. That is my answer.`
  }
}

/**
 * @param scenarioOf injection point for tests; production always derives the
 * scenario from the audio so that the stub stays reproducible.
 */
export function createStubSpeechProvider(
  scenarioOf: (audio: Uint8Array) => StubScenario = stubScenarioFor,
): SpeechProvider {
  return {
    name: 'stub',

    async transcribe(audio, context) {
      const scenario = scenarioOf(audio)
      const vocabulary = (context?.vocabulary ?? []).map((lemma) => lemma.toLowerCase())
      const text = scenarioTranscript(scenario, vocabulary)
      const weak = new Set(scenario === 'unclear' ? vocabulary : [])

      return {
        text,
        words: words(text, (word) => (weak.has(word) ? STUB_LOW_CONFIDENCE : STUB_HIGH_CONFIDENCE)),
      }
    },

    async assess(audio, referenceText) {
      const scenario = scenarioOf(audio)
      const score = scenario === 'unclear' ? 42 : 88
      const assessed = words(referenceText, () => 0).map(({ word }) => ({
        word,
        score,
        phonemes: [...word].map((phoneme) => ({ phoneme, score })),
      }))
      return { accuracy: score, words: assessed }
    },
  }
}
