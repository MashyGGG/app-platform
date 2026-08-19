import { TagLink } from '@/components/Badges'
import { getAllTags } from '@/lib/content'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '标签' }

export default function TagsPage() {
  const tags = getAllTags()

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">标签</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          共 {tags.length} 个标签。
        </p>
      </header>
      {tags.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          还没有标签。
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map(({ tag, count }) => (
            <TagLink key={tag} tag={tag} count={count} />
          ))}
        </div>
      )}
    </div>
  )
}
