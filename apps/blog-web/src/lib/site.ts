/** Site-wide constants. Kept in one place so the header, RSS feed and sitemap
 *  can never disagree about what this site is called or where it lives. */
export const SITE = {
  name: '全栈 · 运维成长笔记',
  shortName: 'devlog',
  description:
    '一个人的全栈 → 运维 → 架构学习日志：Docker 与容器化为起点，沿路记录踩过的坑、报过的错和最后怎么修好的。',
  author: 'Mashy',
  locale: 'zh-CN',
  /** Absolute origin, used by RSS + sitemap. Vercel injects VERCEL_PROJECT_PRODUCTION_URL. */
  url:
    process.env.NEXT_PUBLIC_BLOG_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3002'),
} as const
