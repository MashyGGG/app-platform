import { PostFilter } from '@/components/PostFilter'
import { getAllPosts } from '@/lib/content'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '全部笔记',
  description: '按阶段和关键词筛选所有学习笔记与踩坑记录。',
}

export default function PostsPage() {
  // Strip the body before it crosses into the client component — see PostCard.
  const posts = getAllPosts().map(({ body: _body, ...meta }) => meta)

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">全部笔记</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          学习笔记与踩坑记录，按时间倒序。
        </p>
      </header>
      <PostFilter posts={posts} />
    </div>
  )
}
