// DB-less user accounts: the account record IS a signed cookie.
//
// On registration we bcrypt the password and HMAC-sign a payload
// {u: username, h: bcryptHash, iat: <unix-seconds>} with BETTER_AUTH_SECRET.
// The result is stored as the `azca_account` cookie (HttpOnly, 1-year TTL).
// To log in later the browser presents the cookie, the server verifies the
// HMAC, the user re-types their password, and we bcrypt-compare.
//
// Trade-off: accounts are per-browser. Clearing cookies / switching
// browsers / using a private window means re-registering. No external
// storage of any kind — zero setup, fits Vercel serverless cleanly.

import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

export const ACCOUNT_COOKIE = "azca_account";
export const ACCOUNT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export interface AccountPayload {
  u: string;   // username
  h: string;   // bcrypt hash of the password
  iat: number; // issued-at, unix seconds
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

export function createAccountCookie(
  username: string,
  password: string,
): { value: string; maxAge: number } {
  const secret = getSecret();
  const hash = bcrypt.hashSync(password, 10);
  const payload = b64url(
    JSON.stringify({ u: username, h: hash, iat: Math.floor(Date.now() / 1000) }),
  );
  const sig = sign(payload, secret);
  return { value: `${payload}.${sig}`, maxAge: ACCOUNT_MAX_AGE_SECONDS };
}

export function verifyAccountCookie(
  raw: string | undefined | null,
): AccountPayload | null {
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
    const decoded = JSON.parse(b64urlDecode(payload).toString("utf-8")) as Partial<AccountPayload>;
    if (typeof decoded.u !== "string" || typeof decoded.h !== "string") return null;
    return { u: decoded.u, h: decoded.h, iat: Number(decoded.iat ?? 0) };
  } catch {
    return null;
  }
}

export function verifyPassword(account: AccountPayload, password: string): boolean {
  try {
    return bcrypt.compareSync(password, account.h);
  } catch {
    return false;
  }
}

export function normaliseUsername(s: string): string {
  return s.trim();
}
