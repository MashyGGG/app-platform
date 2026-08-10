import { Redis } from '@upstash/redis'

let client: Redis | null = null

/**
 * Upstash Redis (REST). Used ONLY for rate limiting and short-lived caching —
 * never as a source of user data, and never for sessions (SPEC §1.5).
 *
 * Locally, docker-compose exposes an Upstash-REST-compatible endpoint so this
 * same client works offline.
 */
/**
 * The Upstash integration on the Vercel Marketplace injects its credentials as
 * `KV_REST_API_*` (the names inherited from Vercel KV), while a Redis database
 * created directly on upstash.com hands you `UPSTASH_REDIS_REST_*`. Accept
 * both so neither provisioning route needs hand-copied environment variables.
 */
function readCredentials(): { url?: string; token?: string } {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  }
}

export function getRedis(): Redis {
  if (client) return client

  const { url, token } = readCredentials()

  if (!url || !token) {
    throw new Error(
      'Redis is not configured: set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN ' +
        '(or the KV_REST_API_URL / KV_REST_API_TOKEN pair injected by the Vercel Upstash ' +
        'integration). For local dev run `docker compose up -d` and copy .env.example to .env.',
    )
  }

  client = new Redis({ url, token })
  return client
}

export function isRedisConfigured(): boolean {
  const { url, token } = readCredentials()
  return Boolean(url && token)
}
