import { notFound } from 'next/navigation'
import { PostCard } from '@/components/PostCard'
import { getAllTags, getPostsByTag } from '@/lib/content'
import type { Metadata } from 'next'

type Params = { params: Promise<{ tag: string }> }

export function generateStaticParams() {
  return getAllTags().map(({ tag }) => ({ tag }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tag } = await params
  return { title: `#${decodeURIComponent(tag)}` }
}

export default async function TagPage({ params }: Params) {
  const { tag } = await params
  const decoded = decodeURIComponent(tag)
  const posts = getPostsByTag(decoded)
  if (posts.length === 0) notFound()

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">#{decoded}</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {posts.length} 篇
        </p>
      </header>
      <div className="grid gap-3">
        {posts.map(({ body: _body, ...post }) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  )
}
