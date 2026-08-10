import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

// One .env at the monorepo root feeds both apps locally. On Vercel the file is
// absent and the platform's Environment Variables win — dotenv no-ops.
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true })

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source and must be compiled by Next.
  transpilePackages: ['@app/db', '@app/shared'],
  // Native / engine-backed modules must stay outside the bundle.
  serverExternalPackages: ['@prisma/client', '@node-rs/argon2'],
  outputFileTracingRoot: path.resolve(process.cwd(), '../../'),
  eslint: {
    // Linting is a dedicated root-level CI step (`pnpm lint`).
    ignoreDuringBuilds: true,
  },
}

export default withNextIntl(nextConfig)
