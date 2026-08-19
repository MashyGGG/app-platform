/**
 * Object storage behind one interface (IMPL §4.3).
 *
 * Two implementations: the local filesystem, which dev, CI and the e2e suite
 * use, and Vercel Blob, which production uses (决策 Q2). The database only ever
 * stores a key — nothing above this file knows which store is in play, and
 * swapping Blob for R2/S3 is one more function in this directory.
 *
 * It lives in `@app/shared` rather than in app-web because `speaking:prune`
 * (packages/db) has to delete from the same store the app writes to, and a
 * retention job that guesses at another workspace's storage layout is a
 * retention job that one day deletes the wrong thing.
 *
 * Kept out of `src/speaking/` on purpose: that directory is the Vitest-drivable
 * pure layer and must stay free of `fs` and of vendor SDKs.
 */

export interface StoredAudio {
  bytes: Uint8Array
  contentType: string
}

export interface StoreUsage {
  usedBytes: number
  capacityBytes: number
}

export interface AudioStore {
  readonly name: string
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredAudio | null>
  /** Idempotent: a key that is already gone is a successful delete, not an error. */
  remove(keys: readonly string[]): Promise<void>
  /** Null when the store has no meaningful ceiling — the local filesystem. */
  usage(): Promise<StoreUsage | null>
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

export function takeKey(userId: string, sessionId: string, take: 'main' | 'retry'): string {
  return `takes/${userId}/${sessionId}/${take}.wav`
}

// --- local filesystem --------------------------------------------------------

export function createLocalAudioStore(root: string): AudioStore {
  const resolve = async (key: string) => {
    const path = await import('node:path')
    return path.join(root, ...key.split('/'))
  }

  return {
    name: 'local',

    async put(key, bytes) {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const path = await import('node:path')
      const file = await resolve(key)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes)
    },

    async get(key) {
      const { readFile } = await import('node:fs/promises')
      try {
        const bytes = await readFile(await resolve(key))
        return { bytes: new Uint8Array(bytes), contentType: contentTypeFor(key) }
      } catch {
        return null
      }
    },

    async remove(keys) {
      const { rm } = await import('node:fs/promises')
      for (const key of keys) {
        await rm(await resolve(key), { force: true })
      }
    },

    // No ceiling worth reporting: a dev machine's disk is not the constraint
    // this product is managed against.
    async usage() {
      return null
    },
  }
}

// --- Vercel Blob -------------------------------------------------------------

export interface VercelBlobOptions {
  token?: string
  /** Hobby is 1 GB. The number retention pressure is measured against (IMPL §4.4 红线 3). */
  capacityBytes: number
}

/**
 * `access: 'private'` throughout, and that is not a default worth changing: a
 * public blob URL is a student's own voice, readable by anyone who learns the
 * URL. Playback goes through `/api/speaking/audio/{key}`, which is behind the
 * same session gate as everything else.
 */
export function createVercelBlobAudioStore(options: VercelBlobOptions): AudioStore {
  // Imported lazily so the local store — the one CI and e2e use — never pays for
  // the SDK, and so a missing BLOB_READ_WRITE_TOKEN cannot break a dev boot.
  const sdk = () => import('@vercel/blob')

  return {
    name: 'vercel-blob',

    async put(key, bytes, contentType) {
      const { put } = await sdk()
      await put(key, bytes as unknown as Blob, {
        access: 'private',
        contentType,
        // The key IS the address — `takes/{userId}/{sessionId}/main.wav` is what
        // the database holds, so a random suffix would make it unfindable.
        addRandomSuffix: false,
        // Re-recording before submitting overwrites the same take (see score.ts).
        allowOverwrite: true,
        token: options.token,
      })
    },

    async get(key) {
      const { get } = await sdk()
      try {
        const found = await get(key, { access: 'private', token: options.token })
        if (!found?.stream) return null
        const bytes = new Uint8Array(await new Response(found.stream).arrayBuffer())
        return { bytes, contentType: found.blob.contentType ?? contentTypeFor(key) }
      } catch {
        // A missing take is a 404 to the caller, not a 500: pruned audio is an
        // expected state after seven days, not a fault.
        return null
      }
    },

    async remove(keys) {
      if (keys.length === 0) return
      const { del } = await sdk()
      await del([...keys], { token: options.token })
    },

    async usage() {
      const { list } = await sdk()
      let usedBytes = 0
      let cursor: string | undefined

      // Paged rather than sampled: the whole point of this number is to be
      // trusted when it says the free tier is nearly full.
      do {
        const page = await list({ cursor, limit: 1000, token: options.token })
        usedBytes += page.blobs.reduce((total, blob) => total + blob.size, 0)
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor)

      return { usedBytes, capacityBytes: options.capacityBytes }
    },
  }
}

// --- selection ---------------------------------------------------------------

export interface AudioStoreEnv {
  /** `BLOB_READ_WRITE_TOKEN`. Its presence is what selects Blob. */
  blobToken?: string | undefined
  /** Where the local store writes when there is no token. Absolute. */
  localDir: string
  capacityBytes: number
}

/**
 * One rule for "which store am I talking to", used by both the app and
 * `speaking:prune`.
 *
 * Keyed on the token rather than on a mode flag: a local `vercel env pull` then
 * reaches the real store without a second switch to remember, and CI — which has
 * no token — cannot accidentally reach for a network the e2e suite does not
 * have. A prune run and a page render can never disagree about where the bytes
 * are, which is the entire reason this lives here.
 */
export function createAudioStore(env: AudioStoreEnv): AudioStore {
  if (env.blobToken) {
    return createVercelBlobAudioStore({ token: env.blobToken, capacityBytes: env.capacityBytes })
  }
  return createLocalAudioStore(env.localDir)
}
