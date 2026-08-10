import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string
      role?: 'super_admin' | 'operator'
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'super_admin' | 'operator'
  }
}
