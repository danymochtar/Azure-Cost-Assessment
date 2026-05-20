// Edge middleware: gates every request behind a valid session cookie,
// except the login page, login/logout endpoints, and Next.js static
// assets / icons / manifest.
//
// NOTE: we do NOT verify the HMAC here — middleware runs on the Edge
// runtime where node:crypto isn't fully available. Instead we check
// that the cookie exists and has the right shape; the API routes
// + the server page render do the real HMAC verification via
// verifySessionCookie() (Node runtime).

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-constants";

const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/api/auth/",
  "/_next/",
  "/icon",
  "/apple-icon",
  "/manifest",
  "/favicon",
  "/robots",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  // Cheap structural check on the Edge — real HMAC verification happens
  // in the Node-runtime API routes via verifySessionCookie().
  const looksLikeSession =
    typeof raw === "string" && raw.includes(".") && raw.length > 32;
  if (looksLikeSession) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  if (isApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Apply to everything except Next internals and static files.
    "/((?!_next/static|_next/image|.*\\..*).*)",
  ],
};
