/**
 * Where a freshly authenticated user lands. One constant because both the OTP
 * verify route (which returns it, locale-prefixed) and the client form need it.
 *
 * AC-S9 says the landing page is `/today`; that page arrives with M2, and this
 * is the single line that moves when it does.
 */
export const POST_AUTH_LANDING = '/home'
