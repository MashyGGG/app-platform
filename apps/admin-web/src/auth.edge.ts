import NextAuth from 'next-auth'
import { authEdgeConfig } from '@/auth.config'

/** Edge-runtime instance for middleware only — decodes the JWT, touches no DB. */
export const { auth: authEdge } = NextAuth(authEdgeConfig)
