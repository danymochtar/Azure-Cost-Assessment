import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import { createUser, hasPersistentStore, userExists } from "@/lib/users";

export const runtime = "nodejs";

const BodySchema = z.object({
  identifier: z.string().min(3, "At least 3 characters").max(120),
  password: z.string().min(8, "At least 8 characters").max(256),
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

  if (!hasPersistentStore() && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error:
          "Registration is unavailable: this deployment has no persistent user store. " +
          "Enable Vercel KV (or set KV_REST_API_URL + KV_REST_API_TOKEN).",
      },
      { status: 503 },
    );
  }

  if (await userExists(body.identifier)) {
    return NextResponse.json(
      { error: "An account with that email or username already exists." },
      { status: 409 },
    );
  }

  let record;
  try {
    record = await createUser(body.identifier, body.password);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Failed to create account" },
      { status: 500 },
    );
  }

  const session = createSessionCookie(record.identifier);
  const res = NextResponse.json({ ok: true, user: record.identifier });
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
