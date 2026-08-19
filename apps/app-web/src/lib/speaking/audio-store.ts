import 'server-only'
import path from 'node:path'
import {
  contentTypeFor,
  createAudioStore,
  isValidAudioKey,
  takeKey,
  type AudioStore,
  type StoredAudio,
} from '@app/shared/audio-store'
import { AUDIO_SAMPLE_RATE, encodeWav } from '@app/shared/speaking'
import { audioDir, blobCapacityBytes, servesAudioPlaceholder } from './config'

/**
 * The app's view of the store (IMPL §4.3).
 *
 * The interface and both implementations live in `@app/shared/audio-store`,
 * because `speaking:prune` has to delete from the very store this file writes
 * to, and a retention job that guesses at the app's storage layout is one that
 * eventually deletes the wrong thing. What stays here is the app-only part:
 * which implementation this process gets, and turning a key into something a
 * browser can play.
 */
export { contentTypeFor, isValidAudioKey, takeKey }
export type { AudioStore, StoredAudio }

/** Blob in production, the filesystem everywhere else — see `createAudioStore`. */
export function selectAudioStore(): AudioStore {
  return createAudioStore({
    blobToken: process.env.BLOB_READ_WRITE_TOKEN,
    localDir: path.resolve(process.cwd(), audioDir()),
    capacityBytes: blobCapacityBytes(),
  })
}

let cached: AudioStore | null = null

export function getAudioStore(): AudioStore {
  cached ??= selectAudioStore()
  return cached
}

/** One second of silence, at the product's one format. See `servesAudioPlaceholder`. */
export function audioPlaceholder(): StoredAudio | null {
  if (!servesAudioPlaceholder()) return null
  return { bytes: encodeWav(new Int16Array(AUDIO_SAMPLE_RATE)), contentType: 'audio/wav' }
}

/** The URL a client plays a stored key from. Keys never reach the client raw. */
export function audioUrl(key: string | null | undefined): string | null {
  if (!key || !isValidAudioKey(key)) return null
  return `/api/speaking/audio/${key}`
}
