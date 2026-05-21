import { NextResponse } from "next/server";
import { hasDatabase, prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session-server";
import { findUser } from "@/lib/users";

export const runtime = "nodejs";

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
