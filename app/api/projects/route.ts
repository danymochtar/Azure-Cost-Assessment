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
  // When `projectId` is present the server updates that row in place
  // (after verifying ownership). When absent we create a new row and
  // auto-suffix the name to keep (user, customer, name) unique.
  projectId: z.string().uuid().optional(),
  customer: z.string().min(1).max(120),
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
  landingZoneTier: z.enum(["none", "basic", "standard", "enterprise"]).default("none"),
  landingZoneComponents: z.array(z.string()).optional(),
  landingZoneParams: z.record(z.string(), z.number()).optional(),
  enableBcdr: z.boolean().default(false),
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

  // Pull `lines` and `items` JSONB too — they're needed for the recap
  // page (monthly total = sum(lines.monthlyCost); VM count = items.length).
  // For the dashboard payload size this is fine; project-detail loads
  // continue to go through GET /api/projects/[id].
  const rows = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      customer: true,
      name: true,
      region: true,
      landingZoneTier: true,
      items: true,
      lines: true,
      updatedAt: true,
      createdAt: true,
    },
  });
  const projects = rows.map((r) => {
    const lines = Array.isArray(r.lines) ? (r.lines as Array<{ monthlyCost?: number }>) : [];
    const items = Array.isArray(r.items) ? r.items : [];
    const monthlyCost = lines.reduce((s, l) => s + (typeof l.monthlyCost === "number" ? l.monthlyCost : 0), 0);
    return {
      id: r.id,
      customer: r.customer,
      name: r.name,
      region: r.region,
      landingZoneTier: r.landingZoneTier,
      vmCount: items.length,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      annualCost: Math.round(monthlyCost * 12 * 100) / 100,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    };
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
    customer: body.customer,
    pricingMode: body.pricingMode,
    computeMode: body.computeMode,
    useAhbWindows: body.useAhbWindows,
    nonProdPayg: body.nonProdPayg,
    defaultDiskTier: body.defaultDiskTier,
    autoDiskTier: body.autoDiskTier,
    applyHeadroom: body.applyHeadroom,
    headroom: body.headroom,
    landingZoneTier: body.landingZoneTier,
    landingZoneComponents: (body.landingZoneComponents ?? null) as unknown as Prisma.InputJsonValue,
    landingZoneParams: (body.landingZoneParams ?? null) as unknown as Prisma.InputJsonValue,
    enableBcdr: body.enableBcdr,
    activePillars: body.activePillars as unknown as Prisma.InputJsonValue,
    items: body.items as unknown as Prisma.InputJsonValue,
    lines: body.lines as unknown as Prisma.InputJsonValue,
  };

  const createData: Prisma.ProjectUncheckedCreateInput = {
    userId,
    customer: body.customer,
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
    landingZoneTier: body.landingZoneTier,
    landingZoneComponents: (body.landingZoneComponents ?? null) as unknown as Prisma.InputJsonValue,
    landingZoneParams: (body.landingZoneParams ?? null) as unknown as Prisma.InputJsonValue,
    enableBcdr: body.enableBcdr,
    activePillars: body.activePillars as unknown as Prisma.InputJsonValue,
    items: body.items as unknown as Prisma.InputJsonValue,
    lines: body.lines as unknown as Prisma.InputJsonValue,
  };
  let project;
  if (body.projectId) {
    // In-place update — scoped to ownership so a leaked id can't clobber
    // someone else's row. If the row no longer exists (deleted from the
    // recap page mid-session) we fall through to the create path below.
    const owned = await prisma.project.findFirst({
      where: { id: body.projectId, userId },
      select: { id: true },
    });
    if (owned) {
      project = await prisma.project.update({ where: { id: body.projectId }, data });
    }
  }
  if (!project) {
    // Auto-suffix name on collision. Walk " 2", " 3", … until the
    // (userId, customer, name) tuple is free, matching the user's
    // expectation of "same customer + same project → keep both".
    const baseName = body.name;
    const existing = await prisma.project.findMany({
      where: { userId, customer: body.customer, name: { startsWith: baseName } },
      select: { name: true },
    });
    const taken = new Set(existing.map((r) => r.name));
    let unique = baseName;
    let suffix = 2;
    while (taken.has(unique)) {
      unique = `${baseName} ${suffix}`;
      suffix += 1;
    }
    createData.name = unique;
    project = await prisma.project.create({ data: createData });
  }

  return NextResponse.json({
    ok: true,
    project: {
      id: project.id,
      customer: project.customer,
      name: project.name,
      updatedAt: project.updatedAt,
    },
  });
}
