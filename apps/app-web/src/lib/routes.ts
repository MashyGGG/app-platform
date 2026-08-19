/**
 * Where a freshly authenticated user lands. One constant because both the OTP
 * verify route (which returns it, locale-prefixed) and the client form need it.
 *
 * AC-S9: "直接创建账号并进入 `/today`". `/home` still exists as the account
 * screen; it is simply no longer where signing in takes you.
 */
export const POST_AUTH_LANDING = '/today'
