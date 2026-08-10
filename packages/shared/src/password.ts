import { hash, verify } from '@node-rs/argon2'

/**
 * argon2id — the single password hashing algorithm for this platform (SPEC §7).
 * Parameters live here so app-web (registration / login / reset) and the
 * packages/db seed can never drift apart.
 */
const ARGON2ID = 2 as const

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // 19 MiB — OWASP minimum for argon2id
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS)
  } catch {
    // Malformed / foreign hash — treat as a failed login, never as a crash.
    return false
  }
}

/**
 * Constant-ish work for the "no such user / no password on file" branch, so that
 * branch is not distinguishable from a wrong password by response time.
 */
export async function fakeVerify(): Promise<void> {
  await hashPassword('__no_password_on_this_account__')
}
