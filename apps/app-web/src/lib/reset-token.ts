import 'server-only'
import { randomBytes } from 'node:crypto'
import { prisma } from '@app/db'

/**
 * Password-reset tokens reuse the Auth.js `VerificationToken` table, namespaced
 * so they can never collide with adapter-issued email-verification tokens.
 */
const RESET_PREFIX = 'reset:'
const TTL_MS = 60 * 60 * 1000 // 1 hour

function identifierFor(email: string) {
  return `${RESET_PREFIX}${email.toLowerCase()}`
}

/** Issues a fresh token and invalidates any previous one for that email. */
export async function issueResetToken(email: string): Promise<string> {
  const identifier = identifierFor(email)
  const token = randomBytes(32).toString('base64url')

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: { identifier, token, expires: new Date(Date.now() + TTL_MS) },
    }),
  ])

  return token
}

/**
 * Single use (AC-4): the row is deleted whether or not it had expired, so a
 * leaked link cannot be retried.
 */
export async function consumeResetToken(email: string, token: string): Promise<boolean> {
  const identifier = identifierFor(email)

  const row = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier, token } },
  })
  if (!row) return false

  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier, token } },
  })

  return row.expires.getTime() > Date.now()
}
