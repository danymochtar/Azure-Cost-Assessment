import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import {
  ACCOUNT_COOKIE,
  createAccountCookie,
  normaliseUsername,
} from "@/lib/users";

export const runtime = "nodejs";

const BodySchema = z.object({
  username: z.string().min(3, "Username needs at least 3 characters").max(60),
  password: z.string().min(6, "Password needs at least 6 characters").max(256),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const username = normaliseUsername(body.username);
  if (!username) {
    return NextResponse.json({ error: "Username can't be blank" }, { status: 400 });
  }

  let account;
  let session;
  try {
    account = createAccountCookie(username, body.password);
    session = createSessionCookie(username);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, user: username });
  const secure = process.env.NODE_ENV === "production";

  // Persistent (1-year) account record cookie.
  res.cookies.set({
    name: ACCOUNT_COOKIE,
    value: account.value,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: account.maxAge,
  });

  // Short-lived (30-day) signed-in session.
  res.cookies.set({
    name: SESSION_COOKIE,
    value: session.value,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return res;
}
