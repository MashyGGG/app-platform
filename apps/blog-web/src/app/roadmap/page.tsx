import Link from 'next/link'
import { getAllPosts } from '@/lib/content'
import { ROADMAP } from '@/lib/roadmap'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '学习路线',
  description:
    'Docker 起步，再沿前端 → 后端 → 运维 → 架构走完。每个检查点都有一个可验证的交付物，而不是一句"了解一下"。',
}

export default function RoadmapPage() {
  const written = new Set(getAllPosts().map((p) => p.slug))

  return (
    <div>
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">学习路线</h1>
        <p className="mt-3 max-w-2xl leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          从 Docker 开始，再沿 前端 → 后端 → 运维 → 架构 走完。每个检查点都带一个
          <strong style={{ color: 'var(--text)' }}>可验证的交付物</strong>
          ：能做出来才算学过，读完一篇文章不算。
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          带链接的检查点表示笔记已经写了；灰色的还没写。
        </p>
      </header>

      <div className="space-y-14">
        {ROADMAP.map((stage) => (
          <section key={stage.id} id={stage.id} className="scroll-mt-20">
            <div className="border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold tracking-tight">{stage.label}</h2>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  预算 {stage.budget}
                </span>
              </div>
              <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                {stage.tagline}
              </p>
            </div>

            <ol className="mt-5 space-y-5">
              {stage.items.map((item, index) => {
                const hasPost = item.post !== undefined && written.has(item.post)
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border p-4"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-raised)' }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className="font-mono text-xs tabular-nums"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {stage.order}.{index + 1}
                      </span>
                      <h3 className="font-semibold leading-snug">
                        {hasPost ? (
                          <Link href={`/posts/${item.post}`} className="hover:underline">
                            {item.title}
                          </Link>
                        ) : (
                          item.title
                        )}
                      </h3>
                      {hasPost ? (
                        <span className="text-xs" style={{ color: 'var(--accent)' }}>
                          已记录
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          待写
                        </span>
                      )}
                    </div>

                    <p
                      className="mt-2 text-sm leading-relaxed"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {item.why}
                    </p>

                    <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                      {item.topics.map((topic) => (
                        <li key={topic} className="flex gap-2">
                          <span aria-hidden style={{ color: 'var(--border)' }}>
                            ·
                          </span>
                          <span>{topic}</span>
                        </li>
                      ))}
                    </ul>

                    <p
                      className="mt-3 rounded px-3 py-2 text-sm leading-relaxed"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--text)' }}
                    >
                      <strong style={{ color: 'var(--accent)' }}>交付物 · </strong>
                      {item.deliverable}
                    </p>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
