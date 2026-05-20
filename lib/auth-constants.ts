// Tiny shared constants. Lives separately from `lib/auth.ts` so that
// Edge-runtime callers (middleware) can import the cookie name without
// pulling in node:crypto.

export const SESSION_COOKIE = "azca_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
