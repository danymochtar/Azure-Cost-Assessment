import { NextResponse } from "next/server";
import { z } from "zod";
import {
  constantTimeEqualStr,
  createSessionCookie,
  getCredentials,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import { findUser, normaliseUsername, verifyPassword } from "@/lib/users";

export const runtime = "nodejs";

const BodySchema = z.object({
  user: z.string().min(1),
  password: z.string().min(1),
});

function setSession(res: NextResponse, identifier: string) {
  const session = createSessionCookie(identifier);
  res.cookies.set({
    name: SESSION_COOKIE,
    value: session.value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const typedUser = body.user.trim();

  // 1. Postgres-backed user lookup (multi-user registrations).
  try {
    const user = await findUser(typedUser);
    if (user && verifyPassword(user, body.password)) {
      const res = NextResponse.json({ ok: true, user: user.username });
      setSession(res, user.username);
      return res;
    }
  } catch {
    // DB outage shouldn't block the env-var admin fallback below.
  }

  // 2. Bootstrap admin via env vars — always works.
  try {
    const creds = getCredentials();
    const userOk = constantTimeEqualStr(normaliseUsername(typedUser), normaliseUsername(creds.user));
    const passOk = constantTimeEqualStr(body.password, creds.password);
    if (userOk && passOk) {
      const res = NextResponse.json({ ok: true, user: creds.user });
      setSession(res, creds.user);
      return res;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
}
