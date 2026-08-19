import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(process.cwd(), '../../'),
  // Every page is statically generated at build time, so `content/` is only
  // ever read by the build. Tracing it anyway keeps `next start` working from a
  // standalone copy and makes an accidental runtime read fail loudly in dev
  // rather than silently at 3am in production.
  outputFileTracingIncludes: {
    '/**/*': ['./content/**/*'],
  },
  eslint: {
    // Linting is a dedicated root-level CI step (`pnpm lint`).
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
