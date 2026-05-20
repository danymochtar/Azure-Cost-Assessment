// Stateless HMAC-signed session cookies.
//
// Design follows better-auth's cookie naming + httpOnly semantics, but
// drops the database dependency: sessions are pure JWT-like blobs signed
// with BETTER_AUTH_SECRET. Works out of the box on Vercel serverless.
//
// Cookie shape:  base64url(payload).base64url(hmac_sha256(secret, payload))
// Payload:       { u: string, exp: number }  // exp is a UNIX timestamp (s)
//
// Verification compares HMACs in constant time and rejects expired
// payloads. There's no revocation list — to invalidate every session,
// rotate BETTER_AUTH_SECRET.

import { createHmac, timingSafeEqual } from "node:crypto";

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./auth-constants";
import { SESSION_MAX_AGE_SECONDS } from "./auth-constants";

export interface SessionPayload {
  u: string;
  exp: number;
}

function getSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "BETTER_AUTH_SECRET is missing or too short. Set a ≥16-char secret in your env.",
    );
  }
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf as string)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function createSessionCookie(user: string): { value: string; maxAge: number } {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = b64url(JSON.stringify({ u: user, exp }));
  const sig = sign(payload, secret);
  return { value: `${payload}.${sig}`, maxAge: SESSION_MAX_AGE_SECONDS };
}

export function verifySessionCookie(raw: string | undefined | null): SessionPayload | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }

  const expected = sign(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  try {
    const decoded = JSON.parse(b64urlDecode(payload).toString("utf-8")) as Partial<SessionPayload>;
    if (typeof decoded.u !== "string" || typeof decoded.exp !== "number") return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return { u: decoded.u, exp: decoded.exp };
  } catch {
    return null;
  }
}

export function getCredentials(): { user: string; password: string } {
  const user = process.env.APP_USER?.trim() || "admin";
  // APP_PASSWORD falls back to the signing secret so a single env var
  // works for quick personal deployments. Set APP_PASSWORD explicitly
  // before shipping to any public URL.
  const password = process.env.APP_PASSWORD?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (!password) {
    throw new Error("APP_PASSWORD (or BETTER_AUTH_SECRET as fallback) must be set.");
  }
  return { user, password };
}

export function constantTimeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
