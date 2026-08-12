/**
 * Cookie name the web app stores its JWT under. This API never sets this
 * cookie itself (see CLAUDE.md's Authentication section) — it only reads
 * it as a fallback token source, behind the Authorization header.
 */
export const ACCESS_TOKEN_COOKIE_NAME = 'access_token';
