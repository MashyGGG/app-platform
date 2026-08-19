import { hashPassword } from '@app/shared'
import { loadDbEnv } from './src/load-env'
loadDbEnv()
const { prisma } = await import('./src/index')
const [email, plain] = process.argv.slice(2)
if (!email || !plain) throw new Error('usage: <email> <newPassword>')
const u = await prisma.user.update({
  where: { email },
  data: { passwordHash: await hashPassword(plain) },
  select: { email: true, status: true },
})
console.log('✅ password reset for', u.email, '(status:', u.status + ')')
