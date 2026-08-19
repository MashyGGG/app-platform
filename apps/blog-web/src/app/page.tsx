import Link from 'next/link'
import { PostCard } from '@/components/PostCard'
import { getAllPosts, getNotes, getPitfalls } from '@/lib/content'
import { ROADMAP, STAGE_LABELS } from '@/lib/roadmap'
import { SITE } from '@/lib/site'

export default function HomePage() {
  const posts = getAllPosts()
  const recent = posts.slice(0, 5)
  const pitfalls = getPitfalls()
  const notes = getNotes()

  return (
    <div className="space-y-12">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{SITE.name}</h1>
        <p className="mt-3 max-w-2xl leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {SITE.description}
        </p>
        <p
          className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          <span>
            <strong style={{ color: 'var(--text)' }}>{notes.length}</strong> 篇学习笔记
          </span>
          <span>
            <strong style={{ color: 'var(--text)' }}>{pitfalls.length}</strong> 条踩坑记录
          </span>
          <span>
            <strong style={{ color: 'var(--text)' }}>
              {ROADMAP.reduce((n, s) => n + s.items.length, 0)}
            </strong>{' '}
            个路线检查点
          </span>
        </p>
      </section>

      <section>
        <SectionHeading title="学习路线" href="/roadmap" hrefLabel="完整路线 →" />
        <ol className="mt-4 grid gap-2 sm:grid-cols-5">
          {ROADMAP.map((stage) => (
            <li key={stage.id}>
              <Link
                href={`/roadmap#${stage.id}`}
                className="block h-full rounded-lg border p-3 transition-colors hover:border-current"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-raised)' }}
              >
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  第 {stage.order} 阶段
                </span>
                <span className="mt-0.5 block font-medium">{STAGE_LABELS[stage.id]}</span>
                <span className="mt-1 block text-xs" style={{ color: 'var(--text-muted)' }}>
                  {stage.items.length} 个检查点 · {stage.budget}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <SectionHeading title="最近更新" href="/posts" hrefLabel="全部笔记 →" />
        {recent.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-4 grid gap-3">
            {recent.map(({ body: _body, ...post }) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        )}
      </section>

      {pitfalls.length > 0 && (
        <section>
          <SectionHeading title="最近踩的坑" href="/pitfalls" hrefLabel="全部踩坑 →" />
          <ul className="mt-4 space-y-2">
            {pitfalls.slice(0, 5).map((post) => (
              <li key={post.slug} className="text-sm leading-relaxed">
                <Link href={`/posts/${post.slug}`} className="font-medium hover:underline">
                  {post.title}
                </Link>
                <span style={{ color: 'var(--text-muted)' }}> — {post.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function SectionHeading({
  title,
  href,
  hrefLabel,
}: {
  title: string
  href: string
  hrefLabel: string
}) {
  return (
    <div
      className="flex items-baseline justify-between border-b pb-2"
      style={{ borderColor: 'var(--border)' }}
    >
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <Link href={href} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        {hrefLabel}
      </Link>
    </div>
  )
}

function EmptyState() {
  return (
    <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
      还没有笔记。在 <code>apps/blog-web/content/posts/</code> 里放一个 .md 文件就有了。
    </p>
  )
}
