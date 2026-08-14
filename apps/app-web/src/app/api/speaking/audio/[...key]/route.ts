import { API_ERROR, jsonError } from '@app/shared'
import { requireApiUser } from '@/lib/session'
import { audioPlaceholder, getAudioStore, isValidAudioKey } from '@/lib/speaking/audio-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/speaking/audio/{key} — the only way stored audio reaches a browser.
 *
 * Signed in, always: a student's own take is behind the same gate as the rest of
 * their session, and routing 示范音 through here too means the client never
 * learns a storage key or a bucket URL. When M5 swaps the local store for Vercel
 * Blob, nothing on the client changes.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  const key = (await context.params).key.join('/')
  if (!isValidAudioKey(key)) return jsonError(API_ERROR.NOT_FOUND)

  // A student's take lives under their own id; nobody may fetch another's.
  if (key.startsWith('takes/') && !key.startsWith(`takes/${gate.user.id}/`)) {
    return jsonError(API_ERROR.NOT_FOUND)
  }

  const stored = (await getAudioStore().get(key)) ?? audioPlaceholder()
  if (!stored) return jsonError(API_ERROR.NOT_FOUND)

  return new Response(stored.bytes as unknown as BodyInit, {
    headers: {
      'content-type': stored.contentType,
      'content-length': String(stored.bytes.byteLength),
      // Private: this is either one student's voice or content behind a login.
      'cache-control': 'private, max-age=300',
    },
  })
}
