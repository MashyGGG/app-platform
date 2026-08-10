import { Redis } from '@upstash/redis'

let client: Redis | null = null

/**
 * Upstash Redis (REST). Used ONLY for rate limiting and short-lived caching —
 * never as a source of user data, and never for sessions (SPEC §1.5).
 *
 * Locally, docker-compose exposes an Upstash-REST-compatible endpoint so this
 * same client works offline.
 */
export function getRedis(): Redis {
  if (client) return client

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    throw new Error(
      'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are required. ' +
        'For local dev run `docker compose up -d` and copy .env.example to .env.',
    )
  }

  client = new Redis({ url, token })
  return client
}

export function isRedisConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}
