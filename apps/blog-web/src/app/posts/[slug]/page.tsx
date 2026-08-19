import Link from 'next/link'
import { notFound } from 'next/navigation'
import { KindBadge, LevelBadge, StageBadge, TagLink } from '@/components/Badges'
import { Toc } from '@/components/Toc'
import { getAllPosts, getPost } from '@/lib/content'
import { renderMarkdown } from '@/lib/markdown'
import { formatDate } from '@/lib/post-meta'
import type { Metadata } from 'next'

type Params = { params: Promise<{ slug: string }> }

/** Every post is prerendered at build time; nothing here runs per request. */
export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return {}
  return {
    title: post.title,
    description: post.summary,
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.summary,
      publishedTime: post.date,
      tags: post.tags,
    },
  }
}

export default async function PostPage({ params }: Params) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) notFound()

  const { html, headings } = await renderMarkdown(post.body)

  const all = getAllPosts()
  const index = all.findIndex((p) => p.slug === post.slug)
  const newer = index > 0 ? all[index - 1] : undefined
  const older = index >= 0 && index < all.length - 1 ? all[index + 1] : undefined

  return (
    <div className="lg:grid lg:grid-cols-[1fr_16rem] lg:gap-10">
      <article className="min-w-0">
        <header className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StageBadge stage={post.stage} />
            <KindBadge kind={post.kind} />
            <LevelBadge level={post.level} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatDate(post.date)} · 约 {post.readingMinutes} 分钟
            </span>
          </div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">{post.title}</h1>
          <p className="mt-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {post.summary}
          </p>
        </header>

        <div className="prose prose-sm sm:prose-base" dangerouslySetInnerHTML={{ __html: html }} />

        {post.tags.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <TagLink key={tag} tag={tag} />
            ))}
          </div>
        )}

        <nav
          className="mt-10 grid gap-3 border-t pt-6 text-sm sm:grid-cols-2"
          style={{ borderColor: 'var(--border)' }}
        >
          {older && (
            <Link href={`/posts/${older.slug}`} className="hover:underline">
              <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                ← 更早
              </span>
              {older.title}
            </Link>
          )}
          {newer && (
            <Link
              href={`/posts/${newer.slug}`}
              className="hover:underline sm:col-start-2 sm:text-right"
            >
              <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                更新 →
              </span>
              {newer.title}
            </Link>
          )}
        </nav>
      </article>

      <aside className="order-first lg:order-none">
        <Toc headings={headings} />
      </aside>
    </div>
  )
}
