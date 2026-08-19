'use client'

import { useMemo, useState } from 'react'
import { PostCard, type PostCardData } from './PostCard'
import { STAGE_LABELS } from '@/lib/roadmap'
import { STAGES, type Stage } from '@/lib/post-meta'

/**
 * The only client component in this app.
 *
 * Search runs in the browser over metadata that is already in the payload —
 * there is no search endpoint and no index to build, because a personal blog
 * will not outgrow a linear scan over a few hundred titles this decade. The
 * moment it does, the fix is a prebuilt index, not a server.
 */
export function PostFilter({ posts }: { posts: PostCardData[] }) {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage | 'all'>('all')

  const stagesPresent = useMemo(
    () => STAGES.filter((s) => posts.some((p) => p.stage === s)),
    [posts],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return posts.filter((post) => {
      if (stage !== 'all' && post.stage !== stage) return false
      if (!needle) return true
      const haystack = `${post.title} ${post.summary} ${post.tags.join(' ')}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [posts, query, stage])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标题、摘要、标签…"
          aria-label="搜索笔记"
          className="min-w-[14rem] flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:border-current"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--bg-raised)',
            color: 'var(--text)',
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={stage === 'all'} onClick={() => setStage('all')}>
            全部
          </FilterChip>
          {stagesPresent.map((s) => (
            <FilterChip key={s} active={stage === s} onClick={() => setStage(s)}>
              {STAGE_LABELS[s]}
            </FilterChip>
          ))}
        </div>
      </div>

      <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {visible.length} / {posts.length} 篇
      </p>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          没有匹配的笔记。
        </p>
      ) : (
        <div className="grid gap-3">
          {visible.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-md border px-2.5 py-1 text-xs transition-colors"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        backgroundColor: active ? 'var(--accent-soft)' : 'transparent',
      }}
    >
      {children}
    </button>
  )
}
