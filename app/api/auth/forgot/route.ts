import { NextResponse } from "next/server";
import { z } from "zod";
import { hasDatabase } from "@/lib/prisma";
import { updatePassword, userExists } from "@/lib/users";

export const runtime = "nodejs";

const BodySchema = z.object({
  username: z.string().min(3).max(60),
  newPassword: z.string().min(6, "Password needs at least 6 characters").max(256),
});

/**
 * Simple self-service password reset. Trades verification (we don't
 * send an email or check a recovery question) for simplicity — fits
 * this app's private / small-team deployment model where the URL
 * isn't public and usernames aren't enumerable beyond the team.
 *
 * If you deploy this to the open internet, swap this for an email-based
 * flow with a short-lived signed reset token before going live.
 */
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
      { error: "Password reset unavailable on this deployment — DATABASE_URL is not set." },
      { status: 503 },
    );
  }

  try {
    if (!(await userExists(body.username))) {
      // Intentionally generic — avoids confirming whether a username exists
      // to anyone who comes across the form.
      return NextResponse.json({ ok: true });
    }
    const ok = await updatePassword(body.username, body.newPassword);
    if (!ok) {
      return NextResponse.json({ error: "Could not reset password." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Database unreachable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
}
