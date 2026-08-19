import { getAllPosts, getAllTags } from '@/lib/content'
import { SITE } from '@/lib/site'
import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/roadmap', '/posts', '/pitfalls', '/tags'].map((path) => ({
    url: `${SITE.url}${path}`,
    changeFrequency: 'weekly' as const,
    priority: path === '' ? 1 : 0.7,
  }))

  const posts = getAllPosts().map((post) => ({
    url: `${SITE.url}/posts/${post.slug}`,
    lastModified: post.date,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }))

  const tags = getAllTags().map(({ tag }) => ({
    url: `${SITE.url}/tags/${encodeURIComponent(tag)}`,
    changeFrequency: 'monthly' as const,
    priority: 0.3,
  }))

  return [...staticRoutes, ...posts, ...tags]
}
