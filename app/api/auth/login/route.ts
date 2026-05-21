import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  constantTimeEqualStr,
  createSessionCookie,
  getCredentials,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import {
  ACCOUNT_COOKIE,
  normaliseUsername,
  verifyAccountCookie,
  verifyPassword,
} from "@/lib/users";

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

  const typedUser = normaliseUsername(body.user);

  // 1. Try the per-browser account cookie. This is the registered-user path.
  const ck = await cookies();
  const account = verifyAccountCookie(ck.get(ACCOUNT_COOKIE)?.value);
  if (account) {
    const userOk = constantTimeEqualStr(typedUser, account.u);
    const passOk = userOk && verifyPassword(account, body.password);
    if (userOk && passOk) {
      const res = NextResponse.json({ ok: true });
      setSession(res, account.u);
      return res;
    }
  }

  // 2. Bootstrap admin via env vars — always works regardless of cookies.
  try {
    const creds = getCredentials();
    const userOk = constantTimeEqualStr(typedUser, creds.user);
    const passOk = constantTimeEqualStr(body.password, creds.password);
    if (userOk && passOk) {
      const res = NextResponse.json({ ok: true });
      setSession(res, creds.user);
      return res;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json(
    {
      error: account
        ? "Wrong username or password."
        : "No account on this browser. Create one with the Register button.",
    },
    { status: 401 },
  );
}
