/**
 * Azure Speech, behind `SpeechProvider` (IMPL §4.2, 决策 Q4).
 *
 * Two things about this file are deliberate and worth reading before changing
 * it:
 *
 * **One endpoint, not two.** Azure's short-audio REST endpoint does ASR, and the
 * SAME endpoint does pronunciation assessment when you attach the
 * `Pronunciation-Assessment` header. So `assess()` sends the reference text
 * (原则 B's phoneme mode, scripted) and `transcribe()` sends an EMPTY one
 * (Azure's unscripted mode) — one code path, one round trip, and, crucially,
 * per-word accuracy scores in both. Plain `format=detailed` recognition returns
 * a confidence for the utterance but not for each word, and per-word confidence
 * is precisely what winner A's candidate set is drawn from (SPEC §5.3). Going
 * through assessment is what makes that column exist.
 *
 * **`fetch` rather than the SDK.** `microsoft-cognitiveservices-speech-sdk`
 * bundles a WebSocket client and native-ish audio plumbing for a request that is
 * one POST of a WAV we already have in memory. On Vercel that is dependency
 * weight and cold-start time for nothing.
 *
 * Errors leave here as `SpeechProviderError` so `speech-resilience.ts` can tell
 * a 429 (queue it, retry it) from a spent quota (degrade) from a bad key (fail
 * loudly). Nothing in this file retries; that is the wrapper's job.
 */
import { SpeechProviderError, classifyStatus } from './speech-resilience'
import type {
  AssessResult,
  AssessedWord,
  AsrWord,
  SpeechContext,
  SpeechProvider,
  TranscribeResult,
} from './speech'

export interface AzureSpeechConfig {
  key: string
  /** e.g. `eastus`. Ignored when `endpoint` is set. */
  region: string
  /** BCP-47. The MVP's content is English throughout. */
  language?: string
  /** Full override, for sovereign clouds and for tests. */
  endpoint?: string
  fetchImpl?: typeof fetch
  /** Wall clock for one attempt. Below AC-S10's 20 s line on purpose. */
  timeoutMs?: number
}

export const DEFAULT_AZURE_LANGUAGE = 'en-US'
export const DEFAULT_AZURE_TIMEOUT_MS = 15_000

export function azureEndpoint(config: AzureSpeechConfig): string {
  const base =
    config.endpoint ??
    `https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`
  const url = new URL(base)
  url.searchParams.set('language', config.language ?? DEFAULT_AZURE_LANGUAGE)
  url.searchParams.set('format', 'detailed')
  return url.toString()
}

/**
 * The `Pronunciation-Assessment` header — base64 of a JSON parameter block.
 *
 * `Granularity: Phoneme` is what 原则 B asks for by name. `EnableMiscue` is on
 * only for the scripted case: it flags words the student skipped or inserted
 * relative to the reference, which is meaningless when there is no reference.
 */
export function assessmentHeader(referenceText: string): string {
  const params = {
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
    EnableMiscue: referenceText.length > 0,
  }
  return Buffer.from(JSON.stringify(params), 'utf8').toString('base64')
}

// --- response shape ----------------------------------------------------------

interface AzurePhoneme {
  Phoneme?: string
  PronunciationAssessment?: { AccuracyScore?: number }
}

interface AzureWord {
  Word?: string
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string }
  Phonemes?: AzurePhoneme[]
}

interface AzureNBest {
  Display?: string
  Lexical?: string
  PronunciationAssessment?: { AccuracyScore?: number; PronScore?: number }
  Words?: AzureWord[]
}

export interface AzureRecognition {
  RecognitionStatus?: string
  DisplayText?: string
  NBest?: AzureNBest[]
}

function clampScore(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * `NoMatch` / `InitialSilenceTimeout` are NOT errors here.
 *
 * A take with nothing recognisable in it is a real thing a student can produce,
 * and the product already has an answer for it: an empty transcript walks into
 * the winner rules and comes out as C (没说完). Turning silence into a 500 would
 * instead put them on the FAILED branch, telling them the system broke when what
 * broke was the microphone.
 */
export function mapTranscription(body: AzureRecognition): TranscribeResult {
  const best = body.NBest?.[0]
  const text = best?.Display ?? body.DisplayText ?? ''

  const words: AsrWord[] = (best?.Words ?? [])
    .map((word) => ({
      word: (word.Word ?? '').toLowerCase(),
      // Assessment reports 0–100 accuracy; the winner rules speak 0–1 confidence.
      confidence: clampScore(word.PronunciationAssessment?.AccuracyScore) / 100,
    }))
    .filter((word) => word.word.length > 0)

  return { text, words }
}

export function mapAssessment(body: AzureRecognition): AssessResult {
  const best = body.NBest?.[0]

  const words: AssessedWord[] = (best?.Words ?? [])
    .map((word) => ({
      word: (word.Word ?? '').toLowerCase(),
      score: clampScore(word.PronunciationAssessment?.AccuracyScore),
      phonemes: (word.Phonemes ?? []).map((phoneme) => ({
        phoneme: phoneme.Phoneme ?? '',
        score: clampScore(phoneme.PronunciationAssessment?.AccuracyScore),
      })),
    }))
    .filter((word) => word.word.length > 0)

  return { accuracy: clampScore(best?.PronunciationAssessment?.AccuracyScore), words }
}

/** Azure sends `Retry-After` in seconds when the F0 slot is busy. */
export function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number.parseFloat(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined
}

export function createAzureSpeechProvider(config: AzureSpeechConfig): SpeechProvider {
  if (!config.key || !(config.endpoint ?? config.region)) {
    throw new Error('azure speech needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION')
  }

  const doFetch = config.fetchImpl ?? fetch
  const url = azureEndpoint(config)
  const timeoutMs = config.timeoutMs ?? DEFAULT_AZURE_TIMEOUT_MS

  async function recognise(audio: Uint8Array, referenceText: string): Promise<AzureRecognition> {
    // The wrapper's job is to survive a slow vendor; this one is to stop waiting
    // on a dead socket long before the student's 20 s line (AC-S10).
    const abort = AbortSignal.timeout(timeoutMs)

    let response: Response
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': config.key,
          // The one format the product records: 16 kHz mono PCM in a WAV
          // container, straight off the AudioWorklet (IMPL §4.3).
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          Accept: 'application/json',
          'Pronunciation-Assessment': assessmentHeader(referenceText),
        },
        // Copied rather than passed through: `Uint8Array<ArrayBufferLike>` is not
        // a `BodyInit` in every lib this file is typechecked under (packages/db
        // has no DOM lib), and a copy of a few megabytes costs nothing next to
        // the POST it is about to travel in.
        body: new Uint8Array(audio),
        signal: abort,
      })
    } catch (error) {
      // A timeout or a dropped connection: retryable, and never a reason to
      // strand the day.
      throw new SpeechProviderError('transient', `azure speech request failed: ${String(error)}`)
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new SpeechProviderError(
        classifyStatus(response.status, body),
        `azure speech ${response.status}: ${body.slice(0, 200)}`,
        { status: response.status, retryAfterMs: retryAfterMs(response.headers) },
      )
    }

    try {
      return (await response.json()) as AzureRecognition
    } catch (error) {
      throw new SpeechProviderError('transient', `azure speech sent no JSON: ${String(error)}`)
    }
  }

  return {
    name: 'azure',

    /**
     * @param _context the prompt's pre-attached lemmas. The short-audio REST
     * endpoint takes no phrase list — that is a WebSocket-only feature of the
     * SDK — so the bias is not applied here. It costs nothing: the pre-attached
     * words are still the FIRST place winner A looks (SPEC §5.3), and the ASR
     * confidence column is only the fallback for when none of them scored badly.
     */
    async transcribe(audio: Uint8Array, _context?: SpeechContext): Promise<TranscribeResult> {
      return mapTranscription(await recognise(audio, ''))
    },

    async assess(audio: Uint8Array, referenceText: string): Promise<AssessResult> {
      return mapAssessment(await recognise(audio, referenceText))
    },
  }
}
