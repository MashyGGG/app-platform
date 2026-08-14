/**
 * 16 kHz mono PCM WAV — the ONE audio format of the daily-speaking MVP.
 *
 * IMPL §4.3: the browser records straight to 16 kHz PCM via an AudioWorklet and
 * uploads a single WAV that serves both playback and scoring, so that Vercel
 * never has to carry ffmpeg. This module is the contract both ends share: the
 * client encodes with `encodeWav`, the route validates with `parseWav`.
 *
 * Deliberately free of `node:*` — it is imported by a browser bundle.
 */

/** Scoring wants uncompressed 16 kHz (原则 B); recording at this rate avoids a resample. */
export const AUDIO_SAMPLE_RATE = 16_000
export const AUDIO_CHANNELS = 1
export const AUDIO_BITS_PER_SAMPLE = 16

/** SPEC §4.1 P2 — "30–90 秒表达观点+理由". */
export const DEFAULT_MIN_DURATION_MS = 30_000
export const DEFAULT_MAX_DURATION_MS = 90_000

/**
 * 90 s × 16 kHz × 2 bytes ≈ 2.9 MB; the cap adds room for the header and a
 * little client-side slop, and nothing more. It exists so an oversized body is
 * rejected before it is read into memory, not as a product rule.
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataBytes: number
  durationMs: number
}

function tagAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  )
}

/**
 * Reads the format and duration out of a RIFF/WAVE container, or returns null
 * if the bytes are not one.
 *
 * Walks the chunk list rather than assuming the canonical 44-byte header:
 * browsers and recorders legitimately emit `LIST`/`fact` chunks before `data`,
 * and a parser that trusts fixed offsets reads the duration off the wrong bytes
 * instead of failing loudly.
 */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.byteLength < 44) return null
  if (tagAt(bytes, 0) !== 'RIFF' || tagAt(bytes, 8) !== 'WAVE') return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format: Pick<WavInfo, 'sampleRate' | 'channels' | 'bitsPerSample'> | null = null
  let offset = 12

  while (offset + 8 <= bytes.byteLength) {
    const id = tagAt(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8

    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.byteLength) {
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      if (!format) return null
      const bytesPerFrame = (format.bitsPerSample / 8) * format.channels
      if (bytesPerFrame <= 0 || format.sampleRate <= 0) return null
      // Trust the shorter of the two: a truncated upload declares a `data` size
      // it never delivered, and believing the header would over-report duration.
      const dataBytes = Math.max(0, Math.min(size, bytes.byteLength - body))
      return {
        ...format,
        dataBytes,
        durationMs: Math.round((dataBytes / bytesPerFrame / format.sampleRate) * 1000),
      }
    }

    // Chunks are word-aligned: an odd size is followed by one pad byte.
    offset = body + size + (size % 2)
  }

  return null
}

export interface AudioRejection {
  reason: 'not_wav' | 'wrong_format' | 'too_short' | 'too_long'
  /** Filled in for the duration reasons so the client can say by how much. */
  durationMs?: number
}

export interface AudioLimits {
  minDurationMs: number
  maxDurationMs: number
}

export type AudioCheck = { ok: true; info: WavInfo } | { ok: false; rejection: AudioRejection }

/**
 * The single gate every uploaded take passes. Pure, so the boundary table lives
 * in Vitest instead of costing an e2e round trip per row.
 */
export function checkAudio(bytes: Uint8Array, limits: AudioLimits): AudioCheck {
  const info = parseWav(bytes)
  if (!info) return { ok: false, rejection: { reason: 'not_wav' } }

  if (
    info.sampleRate !== AUDIO_SAMPLE_RATE ||
    info.channels !== AUDIO_CHANNELS ||
    info.bitsPerSample !== AUDIO_BITS_PER_SAMPLE
  ) {
    return { ok: false, rejection: { reason: 'wrong_format' } }
  }

  if (info.durationMs < limits.minDurationMs) {
    return { ok: false, rejection: { reason: 'too_short', durationMs: info.durationMs } }
  }
  if (info.durationMs > limits.maxDurationMs) {
    return { ok: false, rejection: { reason: 'too_long', durationMs: info.durationMs } }
  }

  return { ok: true, info }
}

/**
 * The i18n key the client shows for each way a take can be rejected.
 *
 * Here rather than in the route because two endpoints now share the gate (the
 * main take and the retry, AC-S4) and because these keys are emitted by a
 * lookup, not by a schema — nothing else can collect them for the message
 * contract test, so the list has to be exported from somewhere pure.
 */
export const AUDIO_REJECTION_KEYS = {
  not_wav: 'errors.audioNotWav',
  wrong_format: 'errors.audioWrongFormat',
  too_short: 'errors.audioTooShort',
  too_long: 'errors.audioTooLong',
} as const satisfies Record<AudioRejection['reason'], string>

export function audioRejectionKey(reason: AudioRejection['reason']): string {
  return AUDIO_REJECTION_KEYS[reason]
}

/** Wraps 16-bit PCM frames in a canonical 44-byte RIFF header. */
export function encodeWav(samples: Int16Array, sampleRate = AUDIO_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeTag = (offset: number, tag: string) => {
    for (let i = 0; i < tag.length; i += 1) view.setUint8(offset + i, tag.charCodeAt(i))
  }

  writeTag(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeTag(8, 'WAVE')
  writeTag(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // PCM, uncompressed
  view.setUint16(22, AUDIO_CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * AUDIO_CHANNELS * 2, true) // byte rate
  view.setUint16(32, AUDIO_CHANNELS * 2, true) // block align
  view.setUint16(34, AUDIO_BITS_PER_SAMPLE, true)
  writeTag(36, 'data')
  view.setUint32(40, dataBytes, true)

  new Int16Array(buffer, 44).set(samples)
  return new Uint8Array(buffer)
}
