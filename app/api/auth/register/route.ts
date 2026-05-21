import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import { createUser, userExists } from "@/lib/users";
import { hasDatabase } from "@/lib/prisma";

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
      return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!hasDatabase()) {
    return NextResponse.json(
      {
        error:
          "Registration is unavailable on this deployment — DATABASE_URL is not set. " +
          "Use the admin login (admin / noventiq by default) or ask the operator to provision the Postgres instance.",
      },
      { status: 503 },
    );
  }

  // Quick existence check so we return 409 cleanly instead of waiting
  // for Prisma to throw a unique-violation. A failure here usually means
  // the database is unreachable (wrong DATABASE_URL, firewall, downtime).
  let exists: boolean;
  try {
    exists = await userExists(body.username);
  } catch (e) {
    return NextResponse.json(
      { error: `Database unreachable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
  if (exists) {
    return NextResponse.json(
      { error: "An account with that username already exists." },
      { status: 409 },
    );
  }

  let record;
  try {
    record = await createUser(body.username, body.password);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const session = createSessionCookie(record.username);
  const res = NextResponse.json({ ok: true, user: record.username });
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
