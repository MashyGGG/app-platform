import 'server-only'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AUDIO_SAMPLE_RATE, encodeWav } from '@app/shared/speaking'
import { audioDir, servesAudioPlaceholder } from './config'

/**
 * Object storage behind one interface (IMPL §4.3).
 *
 * Today there is a local-filesystem implementation, which is what dev, CI and
 * the e2e suite use. Vercel Blob lands in M5 as a second implementation of this
 * same interface — plus `speaking:prune`, because the Hobby tier's 1 GB holds
 * only ~340 takes (IMPL §4.4 红线 3). Nothing above this file knows which one
 * is in play, and the database only ever stores a key.
 */

export interface StoredAudio {
  bytes: Uint8Array
  contentType: string
}

export interface AudioStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredAudio | null>
}

/**
 * Keys are internal, but they end up in a URL path, so validate rather than
 * trust: a key is lowercase-ish path segments and nothing that can climb out of
 * the storage root.
 */
const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/

export function isValidAudioKey(key: string): boolean {
  return KEY.test(key) && !key.includes('..') && !key.includes('//')
}

export function contentTypeFor(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg'
  if (key.endsWith('.m4a')) return 'audio/mp4'
  return 'audio/wav'
}

function localStore(root: string): AudioStore {
  const resolve = (key: string) => path.join(root, ...key.split('/'))

  return {
    async put(key, bytes) {
      const file = resolve(key)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes)
    },

    async get(key) {
      try {
        const bytes = await readFile(resolve(key))
        return { bytes: new Uint8Array(bytes), contentType: contentTypeFor(key) }
      } catch {
        return null
      }
    },
  }
}

let cached: AudioStore | null = null

export function getAudioStore(): AudioStore {
  cached ??= localStore(path.resolve(process.cwd(), audioDir()))
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

export function takeKey(userId: string, sessionId: string, take: 'main' | 'retry'): string {
  return `takes/${userId}/${sessionId}/${take}.wav`
}
