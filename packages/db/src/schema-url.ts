/**
 * Puts the Prisma `schema` parameter into a connection string.
 *
 * Why this exists: when the platform provisions the database for you (the Neon
 * integration on Vercel, for instance) it injects `DATABASE_URL` as a managed,
 * read-only variable. If that database is shared with another project, our
 * tables must live in their own PostgreSQL schema — but we cannot edit the
 * injected URL to say so.
 *
 * So `DATABASE_SCHEMA` is a separate knob: set it, and every connection string
 * is rewritten to target that schema. An explicit `?schema=` already present in
 * the URL always wins, so nothing changes for anyone who controls their own
 * connection string. Unset, everything behaves exactly as before (PostgreSQL
 * defaults to `public`).
 */
export function withSchema(
  url: string | undefined,
  schema: string | undefined,
): string | undefined {
  if (!url || !schema) return url

  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('schema')) return url
    parsed.searchParams.set('schema', schema)
    return parsed.toString()
  } catch {
    // Not a URL we can parse — hand it back untouched and let Prisma complain
    // about it with a much better message than we could produce here.
    return url
  }
}

/**
 * Rewrites DATABASE_URL / DIRECT_URL in place. Called both by the runtime client
 * and by prisma.config.ts, so `prisma migrate` and the app always agree on which
 * schema they are pointed at — a mismatch there is the kind of bug that only
 * shows up in production.
 */
export function applySchemaToEnv(env: NodeJS.ProcessEnv = process.env): void {
  const schema = env.DATABASE_SCHEMA
  if (!schema) return

  const database = withSchema(env.DATABASE_URL, schema)
  if (database) env.DATABASE_URL = database

  const direct = withSchema(env.DIRECT_URL, schema)
  if (direct) env.DIRECT_URL = direct
}
