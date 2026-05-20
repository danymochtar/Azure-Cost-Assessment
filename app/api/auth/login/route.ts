import { NextResponse } from "next/server";
import { z } from "zod";
import {
  constantTimeEqualStr,
  createSessionCookie,
  getCredentials,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import { findUser, verifyPassword } from "@/lib/users";

export const runtime = "nodejs";

const BodySchema = z.object({
  user: z.string().min(1),
  password: z.string().min(1),
});

function setSessionCookie(res: NextResponse, identifier: string) {
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

  // 1. Look the identifier up in the persistent user store first.
  try {
    const record = await findUser(body.user);
    if (record && verifyPassword(record, body.password)) {
      const res = NextResponse.json({ ok: true });
      setSessionCookie(res, record.identifier);
      return res;
    }
  } catch {
    // KV failure shouldn't block the env-var fallback below.
  }

  // 2. Fall back to the single env-var credential (bootstrap admin).
  try {
    const creds = getCredentials();
    const userOk = constantTimeEqualStr(body.user, creds.user);
    const passOk = constantTimeEqualStr(body.password, creds.password);
    if (userOk && passOk) {
      const res = NextResponse.json({ ok: true });
      setSessionCookie(res, creds.user);
      return res;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
}
