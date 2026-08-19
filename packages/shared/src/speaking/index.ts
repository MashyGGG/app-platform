/**
 * Daily-speaking domain logic — pure functions only.
 *
 * Exported as the `@app/shared/speaking` subpath rather than from the package
 * root so importing it (from the import CLI, say) does not drag in Resend,
 * Upstash and argon2. Keep this directory free of Prisma and fs: everything
 * here must stay Vitest-drivable without a database (IMPL §4.6).
 */
export * from './azure-speech'
export * from './content'
export * from './otp'
export * from './otp-hash'
export * from './progress'
export * from './retention'
export * from './rotation'
export * from './speech'
export * from './speech-resilience'
export * from './test-hook'
export * from './wav'
export * from './winner'
