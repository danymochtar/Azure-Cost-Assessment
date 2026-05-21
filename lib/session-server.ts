// Server-side helper for reading the current signed-in user from
// route handlers. Returns the username from the session cookie, or
// null when the request isn't authenticated.

import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/auth";

export async function getCurrentUser(): Promise<string | null> {
  const ck = await cookies();
  const session = verifySessionCookie(ck.get(SESSION_COOKIE)?.value);
  return session?.u ?? null;
}
