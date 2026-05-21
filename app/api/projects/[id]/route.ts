import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { hasDatabase, prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session-server";
import { findUser } from "@/lib/users";

export const runtime = "nodejs";

const PatchBody = z.object({
  customer: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(120).optional(),
});

// GET /api/projects/[id] — load a saved project's full state.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabase()) return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  const { id } = await ctx.params;
  const username = await getCurrentUser();
  if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await findUser(username);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project });
}

// PATCH /api/projects/[id] — rename (and / or move customer) a saved
// project. Surfaced for the recap-page inline edit; the create flow
// uses POST /api/projects which handles auto-suffixing on collision.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabase()) return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  const { id } = await ctx.params;
  const username = await getCurrentUser();
  if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await findUser(username);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!body.customer && !body.name) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const existing = await prisma.project.findFirst({ where: { id, userId: user.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Prisma.ProjectUpdateInput = {};
  if (body.customer) data.customer = body.customer;
  if (body.name) data.name = body.name;

  try {
    const project = await prisma.project.update({ where: { id }, data });
    return NextResponse.json({
      ok: true,
      project: { id: project.id, customer: project.customer, name: project.name, updatedAt: project.updatedAt },
    });
  } catch (e) {
    // P2002 = unique-violation on (userId, customer, name). Surface a
    // clean 409 so the UI can prompt the user to pick a different name.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Another project with that customer + name already exists." },
        { status: 409 },
      );
    }
    throw e;
  }
}

// DELETE /api/projects/[id] — remove a saved project.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabase()) return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  const { id } = await ctx.params;
  const username = await getCurrentUser();
  if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await findUser(username);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await prisma.project.deleteMany({
    where: { id, userId: user.id },
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
