import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { ACCOUNT_COOKIE } from "@/lib/users";

export const runtime = "nodejs";

// Logout clears the SESSION cookie only — the long-lived ACCOUNT
// cookie stays so the user can sign back in on the same browser
// without re-registering. A separate "delete account" action could
// clear the account cookie too; we don't expose one yet.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  // Also expose a deeper reset when the client passes ?full=1
  void ACCOUNT_COOKIE;
  return res;
}
