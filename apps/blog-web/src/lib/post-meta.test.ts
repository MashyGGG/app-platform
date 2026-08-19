import { describe, expect, it } from 'vitest'
import {
  byNewest,
  formatDate,
  normalizeTags,
  parseFrontmatter,
  readingTimeMinutes,
  slugFromFilename,
  stripCodeFences,
  type PostMeta,
} from './post-meta'

/**
 * Frontmatter is the one place in this app where a mistake fails *silently* —
 * a mistyped `stage:` renders a post that simply never appears on any index.
 * So the boundary table lives here, per `docs/UNIT-TESTING.md` §1: pure
 * function, no filesystem, no Next.
 */

const valid = {
  title: 'Dockerfile 分层与缓存',
  date: '2026-08-19',
  summary: '一层失效，后面全部失效。',
  stage: 'docker',
}

describe('parseFrontmatter', () => {
  it('accepts a minimal valid record and applies the directory default kind', () => {
    const result = parseFrontmatter(valid, 'pitfall')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.kind).toBe('pitfall')
    expect(result.meta.level).toBe('basic')
    expect(result.meta.tags).toEqual([])
    expect(result.meta.draft).toBe(false)
  })

  it('lets the file override the directory default kind', () => {
    const result = parseFrontmatter({ ...valid, kind: 'note' }, 'pitfall')
    expect(result.ok && result.meta.kind).toBe('note')
  })

  it('normalises a Date back into an ISO day (gray-matter parses bare dates)', () => {
    const result = parseFrontmatter({ ...valid, date: new Date('2026-08-19T00:00:00Z') }, 'note')
    expect(result.ok && result.meta.date).toBe('2026-08-19')
  })

  it.each([
    ['frontmatter absent', undefined],
    ['frontmatter is a list', []],
    ['frontmatter is a string', 'title: x'],
  ])('rejects when %s', (_label, raw) => {
    expect(parseFrontmatter(raw, 'note').ok).toBe(false)
  })

  it.each([
    ['missing title', { ...valid, title: undefined }, 'title'],
    ['blank title', { ...valid, title: '   ' }, 'title'],
    ['missing date', { ...valid, date: undefined }, 'date'],
    ['non-ISO date', { ...valid, date: '19/08/2026' }, 'date'],
    ['impossible date', { ...valid, date: '2026-02-31' }, 'date'],
    ['missing summary', { ...valid, summary: '' }, 'summary'],
    ['unknown stage', { ...valid, stage: 'devops' }, 'stage'],
    ['unknown kind', { ...valid, kind: 'rant' }, 'kind'],
    ['unknown level', { ...valid, level: 'expert' }, 'level'],
    ['tags not a list', { ...valid, tags: 'docker' }, 'tags'],
    ['tags containing a blank', { ...valid, tags: ['docker', ' '] }, 'tags'],
    ['tags containing a non-string', { ...valid, tags: ['docker', 7] }, 'tags'],
    ['non-boolean draft', { ...valid, draft: 'yes' }, 'draft'],
  ])('rejects %s and names the offending key', (_label, raw, key) => {
    const result = parseFrontmatter(raw, 'note')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toContain(key)
  })

  it('reports every problem at once rather than stopping at the first', () => {
    const result = parseFrontmatter({ title: '', stage: 'nope' }, 'note')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })
})

describe('normalizeTags', () => {
  it('lower-cases, trims and de-duplicates', () => {
    expect(normalizeTags([' Docker', 'docker', 'CI '])).toEqual(['docker', 'ci'])
  })

  it('treats absence as an empty list but malformed input as an error', () => {
    expect(normalizeTags(undefined)).toEqual([])
    expect(normalizeTags(null)).toEqual([])
    expect(normalizeTags('docker')).toBeNull()
  })
})

describe('stripCodeFences', () => {
  it('removes fenced blocks so their contents never count as prose', () => {
    const md = [
      '前言',
      '```bash',
      '# 这是注释不是标题',
      'docker run hello-world',
      '```',
      '结尾',
    ].join('\n')
    const stripped = stripCodeFences(md)
    expect(stripped).toContain('前言')
    expect(stripped).toContain('结尾')
    expect(stripped).not.toContain('docker run')
  })

  it('handles tilde fences and fences carrying an info string', () => {
    expect(stripCodeFences('~~~ts\nconst a = 1\n~~~')).not.toContain('const a')
    expect(stripCodeFences('```ts title="a.ts"\nconst a = 1\n```')).not.toContain('const a')
  })
})

describe('readingTimeMinutes', () => {
  it('never reports less than a minute', () => {
    expect(readingTimeMinutes('短。')).toBe(1)
  })

  it('counts CJK per character and latin per word rather than lumping them together', () => {
    const cjk = readingTimeMinutes('容器'.repeat(900))
    const latin = readingTimeMinutes('container '.repeat(900))
    // 1800 CJK chars ≈ 4 min, 900 English words ≈ 4 min. Counting CJK as
    // "words" would have made the first one 1 minute.
    expect(cjk).toBeGreaterThan(2)
    expect(latin).toBeGreaterThan(2)
  })

  it('ignores code blocks — a 200-line YAML dump is not 5 minutes of reading', () => {
    const prose = '这是一段正文。'
    const withCode = `${prose}\n\n\`\`\`yaml\n${'  key: value\n'.repeat(400)}\`\`\`\n`
    expect(readingTimeMinutes(withCode)).toBe(readingTimeMinutes(prose))
  })
})

describe('slugFromFilename', () => {
  it.each([
    ['2026-08-19-dockerfile-layers.md', 'dockerfile-layers'],
    ['dockerfile-layers.md', 'dockerfile-layers'],
    ['2026-08-19-Mixed-Case.MD', 'mixed-case'],
    ['post.mdx', 'post'],
  ])('%s → %s', (filename, slug) => {
    expect(slugFromFilename(filename)).toBe(slug)
  })
})

describe('byNewest', () => {
  const post = (date: string, title: string): PostMeta => ({
    slug: title,
    title,
    date,
    summary: '',
    stage: 'docker',
    kind: 'note',
    level: 'basic',
    tags: [],
    draft: false,
  })

  it('sorts newest first', () => {
    const sorted = [post('2026-01-01', 'a'), post('2026-08-19', 'b')].sort(byNewest)
    expect(sorted.map((p) => p.title)).toEqual(['b', 'a'])
  })

  it('is stable within one day, so the build output never shuffles', () => {
    const sorted = [post('2026-08-19', 'b'), post('2026-08-19', 'a')].sort(byNewest)
    expect(sorted.map((p) => p.title)).toEqual(['a', 'b'])
  })
})

describe('formatDate', () => {
  it('drops leading zeros', () => {
    expect(formatDate('2026-08-05')).toBe('2026 年 8 月 5 日')
  })

  it('passes anything unparseable straight through instead of rendering NaN', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})
