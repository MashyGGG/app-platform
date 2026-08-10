/**
 * Client IP for rate-limit keys and audit rows. On Vercel `x-forwarded-for` is
 * set by the platform; the left-most entry is the client.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || '0.0.0.0'
}
