import { describe, expect, it } from 'vitest'
import {
  AUDIO_SAMPLE_RATE,
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_MIN_DURATION_MS,
  checkAudio,
  encodeWav,
  parseWav,
} from './wav'

/**
 * The upload gate. Every row here would otherwise cost a real recording plus a
 * real HTTP round trip in Playwright — and the interesting ones (a truncated
 * body, a stray `LIST` chunk) cannot be produced by a browser at all.
 */

const LIMITS = { minDurationMs: DEFAULT_MIN_DURATION_MS, maxDurationMs: DEFAULT_MAX_DURATION_MS }

/** `seconds` of silence at the product's one supported format. */
function wav(seconds: number, sampleRate = AUDIO_SAMPLE_RATE): Uint8Array {
  return encodeWav(new Int16Array(Math.round(seconds * sampleRate)), sampleRate)
}

describe('parseWav', () => {
  it('round-trips what encodeWav writes', () => {
    const info = parseWav(wav(45))
    expect(info).toEqual({
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 45 * AUDIO_SAMPLE_RATE * 2,
      durationMs: 45_000,
    })
  })

  it('walks the chunk list instead of trusting fixed offsets', () => {
    const canonical = wav(30)
    // A `LIST` chunk between `fmt ` and `data` is legal and common; a parser
    // reading offset 44 would take metadata for samples.
    const list = new Uint8Array([
      0x4c, 0x49, 0x53, 0x54, 0x04, 0x00, 0x00, 0x00, 0x49, 0x4e, 0x46, 0x4f,
    ])
    const spliced = new Uint8Array(canonical.length + list.length)
    spliced.set(canonical.subarray(0, 36))
    spliced.set(list, 36)
    spliced.set(canonical.subarray(36), 36 + list.length)

    expect(parseWav(spliced)?.durationMs).toBe(30_000)
  })

  it('reports the delivered duration, not the declared one, when a body is truncated', () => {
    const truncated = wav(60).subarray(0, 44 + 30 * AUDIO_SAMPLE_RATE * 2)
    expect(parseWav(truncated)?.durationMs).toBe(30_000)
  })

  it.each([
    ['empty', new Uint8Array()],
    ['too small to hold a header', new Uint8Array(20)],
    ['not RIFF', new Uint8Array(64).fill(0x41)],
  ])('returns null for %s', (_label, bytes) => {
    expect(parseWav(bytes)).toBeNull()
  })
})

describe('checkAudio', () => {
  it.each([
    [DEFAULT_MIN_DURATION_MS / 1000, true],
    [DEFAULT_MIN_DURATION_MS / 1000 - 0.5, false],
    [DEFAULT_MAX_DURATION_MS / 1000, true],
    [DEFAULT_MAX_DURATION_MS / 1000 + 0.5, false],
    [60, true],
  ])('%s seconds → accepted: %s (SPEC §4.1 P2: 30–90s)', (seconds, accepted) => {
    expect(checkAudio(wav(seconds), LIMITS).ok).toBe(accepted)
  })

  it('names which end of the range was missed, and by how much', () => {
    const short = checkAudio(wav(10), LIMITS)
    expect(short).toEqual({ ok: false, rejection: { reason: 'too_short', durationMs: 10_000 } })

    const long = checkAudio(wav(120), LIMITS)
    expect(long).toEqual({ ok: false, rejection: { reason: 'too_long', durationMs: 120_000 } })
  })

  it('rejects a well-formed WAV at the wrong sample rate', () => {
    // 44.1 kHz is what a naive `new AudioContext()` gives you — scoring wants
    // 16 kHz (原则 B), and silently resampling on the server is the ffmpeg
    // dependency this format exists to avoid.
    const check = checkAudio(wav(45, 44_100), LIMITS)
    expect(check).toEqual({ ok: false, rejection: { reason: 'wrong_format' } })
  })

  it('rejects a non-WAV body before looking at any duration', () => {
    expect(checkAudio(new Uint8Array(1024).fill(0xff), LIMITS)).toEqual({
      ok: false,
      rejection: { reason: 'not_wav' },
    })
  })
})
