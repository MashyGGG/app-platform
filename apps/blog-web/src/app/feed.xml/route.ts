import { getAllPosts } from '@/lib/content'
import { SITE } from '@/lib/site'

/**
 * Prerendered into a static file at build time, like every other route here.
 * `force-static` is explicit rather than inferred so that adding a request-time
 * read later fails the build instead of quietly turning the feed dynamic.
 */
export const dynamic = 'force-static'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function GET(): Response {
  const posts = getAllPosts()
  const updated = posts[0]?.date

  const items = posts
    .map((post) => {
      const url = `${SITE.url}/posts/${post.slug}`
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(post.summary)}</description>`,
        ...post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
        '    </item>',
      ].join('\n')
    })
    .join('\n')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(SITE.name)}</title>`,
    `    <link>${SITE.url}</link>`,
    `    <description>${escapeXml(SITE.description)}</description>`,
    `    <language>${SITE.locale}</language>`,
    `    <atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml"/>`,
    ...(updated
      ? [`    <lastBuildDate>${new Date(`${updated}T00:00:00Z`).toUTCString()}</lastBuildDate>`]
      : []),
    items,
    '  </channel>',
    '</rss>',
  ].join('\n')

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600',
    },
  })
}
