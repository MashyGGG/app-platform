import { describe, expect, it } from 'vitest'
import { applySchemaToEnv, withSchema } from './schema-url'

/**
 * The only module here whose production path is *never* exercised locally:
 * `DATABASE_SCHEMA` is unset in dev, in CI and in the E2E job, so every one of
 * these branches first runs for real against a shared production database. Its
 * failure mode is also the worst available — the runtime client and
 * `prisma migrate` disagreeing about which PostgreSQL schema they own.
 */
const base = 'postgresql://user:pw@db.example.com:5432/appdb'

describe('withSchema', () => {
  it('appends the schema when the URL has no query string', () => {
    expect(withSchema(base, 'app_platform')).toBe(`${base}?schema=app_platform`)
  })

  it('leaves an explicit schema alone — the URL author wins', () => {
    // The whole point of the knob is to serve people who *cannot* edit the URL.
    // Overriding an explicit `?schema=` would silently move a database that was
    // already configured correctly.
    const explicit = `${base}?schema=public`
    expect(withSchema(explicit, 'app_platform')).toBe(explicit)
    expect(withSchema(`${base}?sslmode=require&schema=other`, 'app_platform')).toBe(
      `${base}?sslmode=require&schema=other`,
    )
  })

  it('keeps the connection parameters that are already there', () => {
    // Dropping `sslmode` or `pgbouncer` would break the connection outright, or
    // worse, silently downgrade it.
    const url = `${base}?sslmode=require&pgbouncer=true&connection_limit=1`
    const out = withSchema(url, 'app_platform')
    const params = new URL(out ?? '').searchParams
    expect(params.get('sslmode')).toBe('require')
    expect(params.get('pgbouncer')).toBe('true')
    expect(params.get('connection_limit')).toBe('1')
    expect(params.get('schema')).toBe('app_platform')
  })

  it('is a no-op when either side is missing', () => {
    expect(withSchema(base, undefined)).toBe(base)
    expect(withSchema(base, '')).toBe(base)
    expect(withSchema(undefined, 'app_platform')).toBeUndefined()
    expect(withSchema('', 'app_platform')).toBe('')
  })

  it('hands an unparseable string back untouched', () => {
    // Deliberate: Prisma's own error message for a malformed URL is far better
    // than anything this function could produce, so it must not swallow it.
    expect(withSchema('not a url', 'app_platform')).toBe('not a url')
  })

  it('escapes a schema name that needs it', () => {
    const out = withSchema(base, 'my schema&x')
    expect(out).toContain('schema=my+schema%26x')
    expect(new URL(out ?? '').searchParams.get('schema')).toBe('my schema&x')
  })
})

describe('applySchemaToEnv', () => {
  it('rewrites both URLs so app and migrations cannot disagree', () => {
    const env = { DATABASE_SCHEMA: 'app_platform', DATABASE_URL: base, DIRECT_URL: `${base}?x=1` }
    applySchemaToEnv(env)
    expect(env.DATABASE_URL).toBe(`${base}?schema=app_platform`)
    expect(env.DIRECT_URL).toBe(`${base}?x=1&schema=app_platform`)
  })

  it('does nothing at all when DATABASE_SCHEMA is unset', () => {
    // The path every local run and the whole CI matrix actually takes.
    const env = { DATABASE_URL: base, DIRECT_URL: base }
    applySchemaToEnv(env)
    expect(env).toEqual({ DATABASE_URL: base, DIRECT_URL: base })
  })

  it('does not invent a variable that was not set', () => {
    // A `DIRECT_URL` conjured out of nothing would point migrations at a pooled
    // connection, which fails in a confusing way much later.
    const withoutDirect: NodeJS.ProcessEnv = { DATABASE_SCHEMA: 'app_platform', DATABASE_URL: base }
    applySchemaToEnv(withoutDirect)
    expect('DIRECT_URL' in withoutDirect).toBe(false)

    // And the mirror case — `DIRECT_URL` alone is what `prisma.config.ts` sees
    // when migrations are run from an environment that has no pooled URL.
    const withoutDatabase: NodeJS.ProcessEnv = { DATABASE_SCHEMA: 'app_platform', DIRECT_URL: base }
    applySchemaToEnv(withoutDatabase)
    expect('DATABASE_URL' in withoutDatabase).toBe(false)
    expect(withoutDatabase.DIRECT_URL).toBe(`${base}?schema=app_platform`)
  })

  it('is idempotent', () => {
    const env = { DATABASE_SCHEMA: 'app_platform', DATABASE_URL: base, DIRECT_URL: base }
    applySchemaToEnv(env)
    const once = { ...env }
    applySchemaToEnv(env)
    expect(env).toEqual(once)
  })
})
