import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { cache } from 'react'
import {
  byNewest,
  parseFrontmatter,
  readingTimeMinutes,
  slugFromFilename,
  type Kind,
  type PostMeta,
  type Stage,
} from './post-meta'

export type Post = PostMeta & {
  /** Raw markdown body, frontmatter stripped. */
  body: string
  readingMinutes: number
}

/**
 * Posts are files, not database rows. That is the single biggest design
 * decision in this app and it is deliberate:
 *
 *   - it deploys to Vercel on its own, with no DATABASE_URL, no Prisma engine
 *     and no migration step — see `docs/BLOG-WEB.md`;
 *   - writing a post is `git add`, so the notes are versioned and reviewable
 *     the same way the code they are about is;
 *   - every page can be statically generated, so a note costs nothing to serve.
 */
const CONTENT_ROOT = path.join(process.cwd(), 'content')

const DIRS: ReadonlyArray<{ dir: string; kind: Kind }> = [
  { dir: 'posts', kind: 'note' },
  { dir: 'pitfalls', kind: 'pitfall' },
]

function readDir(dir: string): string[] {
  try {
    return readdirSync(path.join(CONTENT_ROOT, dir)).filter((f) => /\.mdx?$/i.test(f))
  } catch {
    return []
  }
}

/**
 * Loaded once per build. Invalid frontmatter THROWS rather than skipping the
 * file: a typo should break `pnpm build` loudly, not ship a post that silently
 * disappeared from the index.
 */
const loadAll = cache((): Post[] => {
  const posts: Post[] = []
  const seen = new Map<string, string>()

  for (const { dir, kind } of DIRS) {
    for (const filename of readDir(dir)) {
      const relative = `content/${dir}/${filename}`
      const raw = readFileSync(path.join(CONTENT_ROOT, dir, filename), 'utf8')
      const { data, content } = matter(raw)

      const parsed = parseFrontmatter(data, kind)
      if (!parsed.ok) {
        throw new Error(`Invalid frontmatter in ${relative}:\n  - ${parsed.errors.join('\n  - ')}`)
      }

      const slug = slugFromFilename(filename)
      const previous = seen.get(slug)
      if (previous) {
        throw new Error(`Duplicate post slug "${slug}": ${previous} and ${relative}`)
      }
      seen.set(slug, relative)

      posts.push({
        ...parsed.meta,
        slug,
        body: content,
        readingMinutes: readingTimeMinutes(content),
      })
    }
  }

  return posts.sort(byNewest)
})

/** Drafts are visible while developing and invisible once built for production. */
export const getAllPosts = cache((): Post[] =>
  loadAll().filter((p) => !p.draft || process.env.NODE_ENV === 'development'),
)

export const getPost = cache((slug: string): Post | undefined =>
  getAllPosts().find((p) => p.slug === slug),
)

export const getPostsByStage = cache((stage: Stage): Post[] =>
  getAllPosts().filter((p) => p.stage === stage),
)

export const getPitfalls = cache((): Post[] => getAllPosts().filter((p) => p.kind === 'pitfall'))

export const getNotes = cache((): Post[] => getAllPosts().filter((p) => p.kind === 'note'))

export const getAllTags = cache((): Array<{ tag: string; count: number }> => {
  const counts = new Map<string, number>()
  for (const post of getAllPosts()) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
})

export const getPostsByTag = cache((tag: string): Post[] =>
  getAllPosts().filter((p) => p.tags.includes(tag.toLowerCase())),
)
