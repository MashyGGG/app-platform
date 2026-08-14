import { AUDIO_SAMPLE_RATE, encodeWav } from '@app/shared/speaking/wav'

/**
 * Float32 microphone frames → the one upload format (16 kHz mono 16-bit WAV).
 *
 * Pure and free of any Web Audio type, so the browser recorder stays a thin
 * shell around functions Vitest can drive. Note the absence of `server-only`:
 * this file is deliberately the one piece of `lib/speaking` that ships to the
 * client.
 */

/** Joins the render quanta the worklet posted into one contiguous buffer. */
export function concatChunks(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const joined = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}

/**
 * Linear resample to 16 kHz.
 *
 * The recorder asks for an `AudioContext` at 16 kHz and browsers normally give
 * it, in which case this is a no-op copy. It exists because "normally" is not
 * "always": a browser that hands back its hardware rate instead would otherwise
 * upload 48 kHz samples inside a header claiming 16 kHz — audio that plays at a
 * third speed and scores as gibberish, with nothing in the file to show why.
 */
export function resampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === AUDIO_SAMPLE_RATE || samples.length === 0) return samples

  const ratio = fromRate / AUDIO_SAMPLE_RATE
  const length = Math.floor(samples.length / ratio)
  const out = new Float32Array(length)

  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, samples.length - 1)
    const weight = position - left
    out[i] = (samples[left] as number) * (1 - weight) + (samples[right] as number) * weight
  }

  return out
}

/** Clamped float [-1, 1] → signed 16-bit, the only depth the format allows. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] as number))
    out[i] = Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff))
  }
  return out
}

/** The whole client-side encode, in the order the recorder needs it. */
export function encodeTake(chunks: readonly Float32Array[], sampleRate: number): Uint8Array {
  return encodeWav(floatToInt16(resampleTo16k(concatChunks(chunks), sampleRate)))
}
