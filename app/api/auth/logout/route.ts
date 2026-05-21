import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

// Clears the session cookie. Account data lives in Postgres now,
// so logging out doesn't touch any per-browser persistent record.
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
  return res;
}
