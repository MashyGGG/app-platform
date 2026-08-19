import Link from 'next/link'
import { KindBadge, LevelBadge, StageBadge } from './Badges'
import { formatDate } from '@/lib/post-meta'
import type { Post } from '@/lib/content'

/**
 * Deliberately NOT `Post`: the card never shows the body, and this component is
 * also rendered inside a client component. Passing the full post would
 * serialise every article's markdown into the HTML payload of the index page.
 */
export type PostCardData = Omit<Post, 'body'>

export function PostCard({ post }: { post: PostCardData }) {
  return (
    <article
      className="rounded-lg border p-4 transition-colors hover:border-current"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-raised)' }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StageBadge stage={post.stage} />
        <KindBadge kind={post.kind} />
        <LevelBadge level={post.level} />
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
          {formatDate(post.date)} · {post.readingMinutes} 分钟
        </span>
      </div>

      <h3 className="text-base font-semibold leading-snug">
        <Link href={`/posts/${post.slug}`} className="hover:underline">
          {post.title}
        </Link>
      </h3>

      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {post.summary}
      </p>

      {post.tags.length > 0 && (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {post.tags.map((tag) => `#${tag}`).join('  ')}
        </p>
      )}
    </article>
  )
}
