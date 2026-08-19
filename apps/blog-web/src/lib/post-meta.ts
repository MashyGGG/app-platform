/**
 * Pure frontmatter / text helpers — no filesystem, no Next, no React.
 *
 * This is the only part of the content pipeline that can fail *silently*: a
 * mistyped `stage:` or a missing `date:` would otherwise render as a blank card
 * nobody notices. So it is validated here, exhaustively, and unit-tested
 * (`post-meta.test.ts`) — exactly the shape of code `docs/UNIT-TESTING.md` says
 * belongs in Vitest rather than in Playwright.
 */

/** The learning path this note belongs to. Order matters — it drives the roadmap. */
export const STAGES = ['docker', 'frontend', 'backend', 'ops', 'architecture'] as const
export type Stage = (typeof STAGES)[number]

export const KINDS = ['note', 'pitfall'] as const
export type Kind = (typeof KINDS)[number]

export const LEVELS = ['basic', 'intermediate', 'advanced'] as const
export type Level = (typeof LEVELS)[number]

export type PostMeta = {
  slug: string
  title: string
  /** ISO `YYYY-MM-DD`. */
  date: string
  summary: string
  stage: Stage
  kind: Kind
  level: Level
  tags: string[]
  draft: boolean
}

export type ParseResult =
  { ok: true; meta: Omit<PostMeta, 'slug'> } | { ok: false; errors: string[] }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/**
 * Validate one post's frontmatter. `defaultKind` comes from the directory the
 * file was found in, so `content/pitfalls/*.md` need not repeat `kind: pitfall`.
 */
export function parseFrontmatter(raw: unknown, defaultKind: Kind): ParseResult {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['frontmatter is missing or not a mapping'] }

  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) errors.push('`title` is required and must be a non-empty string')

  const date = typeof raw.date === 'string' ? raw.date.trim() : toIsoDate(raw.date)
  if (!ISO_DATE.test(date)) errors.push('`date` is required and must look like YYYY-MM-DD')
  else if (!isRealDate(date)) errors.push(`\`date\` is not a real calendar date: ${date}`)

  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  if (!summary) errors.push('`summary` is required — it is what the cards and the RSS feed show')

  if (!oneOf(STAGES, raw.stage)) errors.push(`\`stage\` must be one of: ${STAGES.join(' | ')}`)

  const kind = raw.kind === undefined ? defaultKind : raw.kind
  if (!oneOf(KINDS, kind)) errors.push(`\`kind\` must be one of: ${KINDS.join(' | ')}`)

  const level = raw.level === undefined ? 'basic' : raw.level
  if (!oneOf(LEVELS, level)) errors.push(`\`level\` must be one of: ${LEVELS.join(' | ')}`)

  const tags = normalizeTags(raw.tags)
  if (tags === null) errors.push('`tags` must be a list of non-empty strings')

  if (raw.draft !== undefined && typeof raw.draft !== 'boolean') {
    errors.push('`draft` must be a boolean when present')
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    meta: {
      title,
      date,
      summary,
      stage: raw.stage as Stage,
      kind: kind as Kind,
      level: level as Level,
      tags: tags ?? [],
      draft: raw.draft === true,
    },
  }
}

/**
 * `Date.parse('2026-02-31')` does NOT return NaN — V8 rolls the day over into
 * March and hands back a perfectly valid timestamp. Round-tripping through
 * Date.UTC and comparing the parts back is the only check that actually
 * rejects a day that does not exist.
 */
export function isRealDate(iso: string): boolean {
  const match = ISO_DATE.exec(iso)
  if (!match) return false
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** gray-matter turns an unquoted `2026-08-19` into a Date. Normalise it back. */
function toIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return ''
}

/** `null` signals "present but malformed"; `[]` means absent, which is fine. */
export function normalizeTags(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const tag of value) {
    if (typeof tag !== 'string' || tag.trim() === '') return null
    const normalized = tag.trim().toLowerCase()
    if (!out.includes(normalized)) out.push(normalized)
  }
  return out
}

/** Markdown minus fenced code — so a `# comment` inside bash never counts as prose. */
export function stripCodeFences(markdown: string): string {
  return markdown.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '')
}

/**
 * Reading time in minutes. CJK is counted per character and latin per word,
 * because 400 Chinese characters and 400 English words are nowhere near the
 * same amount of reading.
 */
export function readingTimeMinutes(markdown: string): number {
  const prose = stripCodeFences(markdown)
  const cjk = (prose.match(/[一-鿿぀-ヿ]/g) ?? []).length
  const latin = (prose.replace(/[一-鿿぀-ヿ]/g, ' ').match(/\b[\w'-]+\b/g) ?? []).length
  const minutes = cjk / 450 + latin / 220
  return Math.max(1, Math.round(minutes))
}

/** Newest first; same-day posts fall back to title so the order is stable. */
export function byNewest(a: PostMeta, b: PostMeta): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  return a.title.localeCompare(b.title, 'zh-CN')
}

/** `content/posts/2026-08-19-foo.md` → `foo`. The date prefix is filing, not URL. */
export function slugFromFilename(filename: string): string {
  return filename
    .replace(/\.mdx?$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .toLowerCase()
}

export function formatDate(iso: string): string {
  // Anything that is not a well-formed ISO day passes straight through. The
  // naive `split('-')` version renders `not 年 NaN 月 NaN 日` for junk input,
  // which looks like a rendering bug rather than a bad post.
  if (!ISO_DATE.test(iso)) return iso
  const [y, m, d] = iso.split('-') as [string, string, string]
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`
}
