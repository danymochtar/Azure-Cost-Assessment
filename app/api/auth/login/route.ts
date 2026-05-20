import { NextResponse } from "next/server";
import { z } from "zod";
import {
  constantTimeEqualStr,
  createSessionCookie,
  getCredentials,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";

export const runtime = "nodejs";

const BodySchema = z.object({
  user: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  let creds: { user: string; password: string };
  try {
    creds = getCredentials();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const userOk = constantTimeEqualStr(body.user, creds.user);
  const passOk = constantTimeEqualStr(body.password, creds.password);
  if (!userOk || !passOk) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const session = createSessionCookie(creds.user);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: session.value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
