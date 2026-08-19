import { describe, expect, it } from 'vitest'
import { AUDIO_SAMPLE_RATE, parseWav } from '@app/shared/speaking/wav'
import { concatChunks, encodeTake, floatToInt16, resampleTo16k } from './pcm'

/**
 * The client-side encode. Branches that would otherwise first run in a real
 * browser on a real microphone — where a resampling bug shows up as "the audio
 * sounds fine but always scores badly" rather than as a stack trace.
 */

/** One second of a sine at `hz`, sampled at `rate`. */
function tone(hz: number, rate: number, seconds = 1): Float32Array {
  const samples = new Float32Array(Math.round(rate * seconds))
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin((2 * Math.PI * hz * i) / rate)
  return samples
}

describe('concatChunks', () => {
  it('joins render quanta in order', () => {
    const joined = concatChunks([
      new Float32Array([1, 2]),
      new Float32Array([3]),
      new Float32Array(),
    ])
    expect([...joined]).toEqual([1, 2, 3])
  })

  it('returns an empty buffer when nothing was recorded', () => {
    expect(concatChunks([])).toHaveLength(0)
  })
})

describe('resampleTo16k', () => {
  it('is a no-op when the context already runs at 16 kHz', () => {
    const samples = tone(440, AUDIO_SAMPLE_RATE)
    expect(resampleTo16k(samples, AUDIO_SAMPLE_RATE)).toBe(samples)
  })

  it.each([44_100, 48_000, 8_000])('rescales a one-second buffer from %s Hz', (rate) => {
    expect(resampleTo16k(tone(440, rate), rate)).toHaveLength(AUDIO_SAMPLE_RATE)
  })

  it('preserves the waveform, not just the length', () => {
    // A 48 kHz → 16 kHz drop is what a browser that ignores the requested rate
    // would hand us. The resampled tone must still be that tone: a length-only
    // check passes even for an implementation that returns silence.
    const resampled = resampleTo16k(tone(200, 48_000), 48_000)
    const peak = Math.max(...resampled.map(Math.abs))
    expect(peak).toBeGreaterThan(0.9)

    let crossings = 0
    for (let i = 1; i < resampled.length; i += 1) {
      if ((resampled[i - 1] as number) < 0 && (resampled[i] as number) >= 0) crossings += 1
    }
    // 200 Hz for one second = 200 rising zero crossings, ±1 at the edges.
    expect(crossings).toBeGreaterThanOrEqual(199)
    expect(crossings).toBeLessThanOrEqual(201)
  })
})

describe('floatToInt16', () => {
  it.each([
    [0, 0],
    [1, 32767],
    [-1, -32768],
    [0.5, 16384],
    [2, 32767],
    [-2, -32768],
  ])('%s → %s', (input, expected) => {
    expect(floatToInt16(new Float32Array([input]))[0]).toBe(expected)
  })
})

describe('encodeTake', () => {
  it('produces a WAV the server-side gate can read back', () => {
    const chunks = Array.from({ length: 100 }, () => tone(300, 48_000, 0.45))
    const wav = encodeTake(chunks, 48_000)

    expect(parseWav(wav)).toMatchObject({
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      durationMs: 45_000,
    })
  })
})
