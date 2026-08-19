import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AZURE_LANGUAGE,
  assessmentHeader,
  azureEndpoint,
  createAzureSpeechProvider,
  mapAssessment,
  mapTranscription,
  retryAfterMs,
  type AzureRecognition,
} from './azure-speech'
import { SpeechProviderError } from './speech-resilience'

/**
 * The vendor's response shape, mapped. This is a silent-failure parser in the
 * strict sense — every field here is optional in Azure's JSON, and a mapping
 * that quietly produced an empty word list would show up not as an error but as
 * a student being told the wrong thing about their pronunciation.
 */

const AUDIO = new Uint8Array([0, 1, 2, 3])

function recognition(): AzureRecognition {
  return {
    RecognitionStatus: 'Success',
    DisplayText: 'The weekend matters.',
    NBest: [
      {
        Display: 'The weekend matters.',
        PronunciationAssessment: { AccuracyScore: 76.5 },
        Words: [
          {
            Word: 'The',
            PronunciationAssessment: { AccuracyScore: 95 },
            Phonemes: [{ Phoneme: 'dh', PronunciationAssessment: { AccuracyScore: 92 } }],
          },
          {
            Word: 'weekend',
            PronunciationAssessment: { AccuracyScore: 31 },
            Phonemes: [{ Phoneme: 'w', PronunciationAssessment: { AccuracyScore: 30 } }],
          },
        ],
      },
    ],
  }
}

describe('azureEndpoint', () => {
  it('asks for the detailed format — the plain one carries no per-word data', () => {
    const url = new URL(azureEndpoint({ key: 'k', region: 'eastus' }))
    expect(url.host).toBe('eastus.stt.speech.microsoft.com')
    expect(url.searchParams.get('format')).toBe('detailed')
    expect(url.searchParams.get('language')).toBe(DEFAULT_AZURE_LANGUAGE)
  })

  it('honours an explicit endpoint and language', () => {
    const url = new URL(
      azureEndpoint({
        key: 'k',
        region: 'eastus',
        endpoint: 'https://x.test/v1',
        language: 'en-GB',
      }),
    )
    expect(url.host).toBe('x.test')
    expect(url.searchParams.get('language')).toBe('en-GB')
  })
})

describe('assessmentHeader', () => {
  it('always asks for phoneme granularity — 原则 B is not conditional', () => {
    const decode = (header: string) =>
      JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<string, unknown>

    expect(decode(assessmentHeader('read this sentence'))).toMatchObject({
      ReferenceText: 'read this sentence',
      Granularity: 'Phoneme',
      GradingSystem: 'HundredMark',
      // Scripted: skipped and inserted words are meaningful against a reference.
      EnableMiscue: true,
    })

    // Unscripted — the free-speech take. Miscue against no reference is noise.
    expect(decode(assessmentHeader(''))).toMatchObject({ ReferenceText: '', EnableMiscue: false })
  })
})

describe('mapTranscription', () => {
  it('turns 0–100 accuracy into the 0–1 confidence the winner rules read', () => {
    const result = mapTranscription(recognition())

    expect(result.text).toBe('The weekend matters.')
    expect(result.words).toEqual([
      { word: 'the', confidence: 0.95 },
      { word: 'weekend', confidence: 0.31 },
    ])
  })

  it('survives a NoMatch: silence is a take, not a fault', () => {
    // The empty transcript walks into the winner rules and comes out C (没说完).
    // Throwing here would instead put the student on the FAILED branch and tell
    // them the system broke, when what broke was the microphone.
    expect(mapTranscription({ RecognitionStatus: 'NoMatch' })).toEqual({ text: '', words: [] })
  })

  it('drops words with no text and clamps a score out of range', () => {
    const result = mapTranscription({
      NBest: [
        {
          Display: 'hi',
          Words: [
            { Word: '', PronunciationAssessment: { AccuracyScore: 50 } },
            { Word: 'hi', PronunciationAssessment: { AccuracyScore: 140 } },
            { Word: 'there' },
          ],
        },
      ],
    })

    expect(result.words).toEqual([
      { word: 'hi', confidence: 1 },
      // A word Azure returned without a score is not evidence of good
      // pronunciation, so it reads as 0 rather than as "fine".
      { word: 'there', confidence: 0 },
    ])
  })

  it('falls back to DisplayText when NBest is absent', () => {
    expect(mapTranscription({ DisplayText: 'plain text' }).text).toBe('plain text')
  })
})

describe('mapAssessment', () => {
  it('keeps the phoneme breakdown the warm-up read is scored on', () => {
    const result = mapAssessment(recognition())

    expect(result.accuracy).toBe(76.5)
    expect(result.words[1]).toEqual({
      word: 'weekend',
      score: 31,
      phonemes: [{ phoneme: 'w', score: 30 }],
    })
  })

  it('reports zero accuracy rather than NaN when the vendor sends nothing', () => {
    expect(mapAssessment({})).toEqual({ accuracy: 0, words: [] })
  })
})

describe('retryAfterMs', () => {
  it('reads the seconds Azure sends when the F0 slot is busy', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '2' }))).toBe(2000)
    expect(retryAfterMs(new Headers())).toBeUndefined()
    expect(retryAfterMs(new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }))).toBe(
      undefined,
    )
  })
})

describe('createAzureSpeechProvider', () => {
  it('refuses to exist without credentials', () => {
    expect(() => createAzureSpeechProvider({ key: '', region: 'eastus' })).toThrow()
  })

  it('classifies a 429 as throttled and carries Retry-After to the backoff', async () => {
    const provider = createAzureSpeechProvider({
      key: 'k',
      region: 'eastus',
      fetchImpl: async () =>
        new Response('too many requests', { status: 429, headers: { 'retry-after': '3' } }),
    })

    await expect(provider.transcribe(AUDIO)).rejects.toMatchObject({
      kind: 'throttled',
      retryAfterMs: 3000,
      status: 429,
    })
  })

  it('classifies a spent quota from the body, not from the status alone', async () => {
    const provider = createAzureSpeechProvider({
      key: 'k',
      region: 'eastus',
      fetchImpl: async () => new Response('Quota exceeded', { status: 403 }),
    })

    await expect(provider.assess(AUDIO, 'hello')).rejects.toMatchObject({ kind: 'quota' })
  })

  it('turns a network throw into a retryable error, never a permanent one', async () => {
    const provider = createAzureSpeechProvider({
      key: 'k',
      region: 'eastus',
      fetchImpl: async () => {
        throw new Error('ECONNRESET')
      },
    })

    await expect(provider.transcribe(AUDIO)).rejects.toMatchObject({ kind: 'transient' })
  })

  it('sends the audio as 16k WAV with the assessment header attached', async () => {
    let seen: RequestInit | undefined
    const provider = createAzureSpeechProvider({
      key: 'secret',
      region: 'eastus',
      fetchImpl: async (_url, init) => {
        seen = init
        return Response.json(recognition())
      },
    })

    const result = await provider.assess(AUDIO, 'The weekend matters.')

    const headers = seen?.headers as Record<string, string>
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('secret')
    expect(headers['Content-Type']).toContain('samplerate=16000')
    expect(headers['Pronunciation-Assessment']).toBe(assessmentHeader('The weekend matters.'))
    expect(result.accuracy).toBe(76.5)
  })

  it('reports unparsable JSON as transient — a proxy page is not a bad key', async () => {
    const provider = createAzureSpeechProvider({
      key: 'k',
      region: 'eastus',
      fetchImpl: async () => new Response('<html>gateway</html>', { status: 200 }),
    })

    await expect(provider.transcribe(AUDIO)).rejects.toBeInstanceOf(SpeechProviderError)
  })
})
