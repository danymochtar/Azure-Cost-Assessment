import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { hasDatabase, prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session-server";
import { findUser, createUser } from "@/lib/users";
import { normaliseUsername } from "@/lib/users";

export const runtime = "nodejs";

/**
 * Resolve the signed-in username to a User row, creating a placeholder
 * row on first save when the username is the bootstrap admin (which
 * exists only in env vars, not in the DB).
 */
async function getOrCreateUserRow(username: string): Promise<string | null> {
  const u = await findUser(username);
  if (u) return u.id;

  // Bootstrap admin first time saving — create a DB row with a marker
  // password hash so future logins still go through the env-var check
  // (they won't see this row because the env path runs first).
  const marker = await createUser(username, `bootstrap-${Date.now()}-${Math.random()}`).catch(() => null);
  return marker?.id ?? null;
}

const SaveBody = z.object({
  name: z.string().min(1).max(120),
  region: z.string(),
  pricingMode: z.string(),
  computeMode: z.string(),
  useAhbWindows: z.boolean(),
  nonProdPayg: z.boolean(),
  defaultDiskTier: z.string(),
  autoDiskTier: z.boolean(),
  applyHeadroom: z.boolean(),
  headroom: z.number(),
  activePillars: z.array(z.string()),
  items: z.array(z.unknown()),
  lines: z.array(z.unknown()).default([]),
});

// GET /api/projects — list the signed-in user's saved projects.
export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json({ projects: [], dbDisabled: true });
  }
  const username = await getCurrentUser();
  if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await findUser(username);
  if (!user) return NextResponse.json({ projects: [] });

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, region: true, updatedAt: true, createdAt: true },
  });
  return NextResponse.json({ projects });
}

// POST /api/projects — upsert a project by (userId, name).
export async function POST(req: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "Saved projects unavailable on this deployment — DATABASE_URL is not set." },
      { status: 503 },
    );
  }
  const username = await getCurrentUser();
  if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof SaveBody>;
  try {
    body = SaveBody.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const userId = await getOrCreateUserRow(normaliseUsername(username));
  if (!userId) return NextResponse.json({ error: "Could not resolve user" }, { status: 500 });

  // Cast the unknown[] arrays to Prisma's JSON input type — the Zod
  // schema already validated they're well-formed arrays, just not the
  // exact JsonValue index signature Prisma wants.
  const data: Prisma.ProjectUpdateInput = {
    region: body.region,
    pricingMode: body.pricingMode,
    computeMode: body.computeMode,
    useAhbWindows: body.useAhbWindows,
    nonProdPayg: body.nonProdPayg,
    defaultDiskTier: body.defaultDiskTier,
    autoDiskTier: body.autoDiskTier,
    applyHeadroom: body.applyHeadroom,
    headroom: body.headroom,
    activePillars: body.activePillars as unknown as Prisma.InputJsonValue,
    items: body.items as unknown as Prisma.InputJsonValue,
    lines: body.lines as unknown as Prisma.InputJsonValue,
  };

  const createData: Prisma.ProjectUncheckedCreateInput = {
    userId,
    name: body.name,
    region: body.region,
    pricingMode: body.pricingMode,
    computeMode: body.computeMode,
    useAhbWindows: body.useAhbWindows,
    nonProdPayg: body.nonProdPayg,
    defaultDiskTier: body.defaultDiskTier,
    autoDiskTier: body.autoDiskTier,
    applyHeadroom: body.applyHeadroom,
    headroom: body.headroom,
    activePillars: body.activePillars as unknown as Prisma.InputJsonValue,
    items: body.items as unknown as Prisma.InputJsonValue,
    lines: body.lines as unknown as Prisma.InputJsonValue,
  };
  const project = await prisma.project.upsert({
    where: { userId_name: { userId, name: body.name } },
    create: createData,
    update: data,
  });

  return NextResponse.json({
    ok: true,
    project: { id: project.id, name: project.name, updatedAt: project.updatedAt },
  });
}
