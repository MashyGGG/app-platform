import { PostFilter } from '@/components/PostFilter'
import { getPitfalls } from '@/lib/content'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '踩坑记录',
  description: '报错、卡住、白屏、CI 挂掉 —— 现象、原因、修法、教训，一条一条记下来。',
}

export default function PitfallsPage() {
  const posts = getPitfalls().map(({ body: _body, ...meta }) => meta)

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">踩坑记录</h1>
        <p
          className="mt-2 max-w-2xl text-sm leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
        >
          不限于 Docker。每条按{' '}
          <strong style={{ color: 'var(--text)' }}>现象 → 排查 → 原因 → 修法 → 教训</strong>{' '}
          写，重点是最后一条：下次靠什么提前避开，而不是靠记性。
        </p>
      </header>
      <PostFilter posts={posts} />
    </div>
  )
}
