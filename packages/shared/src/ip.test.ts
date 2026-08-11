import { describe, expect, it } from 'vitest'
import { clientIp } from './ip'

/**
 * `clientIp()` decides two things: which bucket a request is rate-limited in
 * (`rl:auth:<action>:<ip>:<email>`) and what goes in the audit row. Both fail
 * *silently* when it is wrong — nothing throws, requests just get throttled
 * against the wrong bucket. E2E cannot catch that, because the suite itself
 * depends on this function trusting `x-forwarded-for` in order to give every
 * browser context its own limiter bucket.
 */
const headers = (init: Record<string, string>) => new Headers(init)

describe('clientIp', () => {
  it('takes the left-most entry of a multi-hop x-forwarded-for', () => {
    // Vercel appends each proxy on the right; the client is always left-most.
    // Reading the right-hand end would put every request in one bucket — the
    // edge network's — and effectively rate-limit the whole platform as one user.
    expect(
      clientIp(headers({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178' })),
    ).toBe('203.0.113.5')
  })

  it('tolerates the whitespace real proxies leave behind', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '  203.0.113.5  ,10.0.0.1' }))).toBe('203.0.113.5')
  })

  it('handles a single-hop header', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '203.0.113.5' }))).toBe('203.0.113.5')
  })

  it('preserves an IPv6 address', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '2001:db8::1, 10.0.0.1' }))).toBe('2001:db8::1')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(clientIp(headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('falls back to x-real-ip when x-forwarded-for is present but empty', () => {
    // An empty or comma-only header must not shadow a usable x-real-ip, and must
    // never produce '' — an empty key segment would merge unrelated clients.
    expect(clientIp(headers({ 'x-forwarded-for': '', 'x-real-ip': '198.51.100.7' }))).toBe(
      '198.51.100.7',
    )
    expect(clientIp(headers({ 'x-forwarded-for': '   ', 'x-real-ip': '198.51.100.7' }))).toBe(
      '198.51.100.7',
    )
    expect(clientIp(headers({ 'x-forwarded-for': ',', 'x-real-ip': '198.51.100.7' }))).toBe(
      '198.51.100.7',
    )
  })

  it('prefers x-forwarded-for when both are present', () => {
    expect(
      clientIp(headers({ 'x-forwarded-for': '203.0.113.5', 'x-real-ip': '198.51.100.7' })),
    ).toBe('203.0.113.5')
  })

  it('returns a non-empty placeholder when nothing identifies the client', () => {
    expect(clientIp(headers({}))).toBe('0.0.0.0')
    expect(clientIp(headers({ 'x-real-ip': '   ' }))).toBe('0.0.0.0')
  })

  it('is case-insensitive about header names, as Headers guarantees', () => {
    expect(clientIp(headers({ 'X-Forwarded-For': '203.0.113.5' }))).toBe('203.0.113.5')
  })
})
