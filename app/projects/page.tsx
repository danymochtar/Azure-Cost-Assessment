import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionCookie, SESSION_COOKIE } from "@/lib/auth";
import { hasDatabase } from "@/lib/prisma";
import ProjectsRecap from "./projects-recap";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const ck = await cookies();
  const session = verifySessionCookie(ck.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  return <ProjectsRecap user={session.u} dbEnabled={hasDatabase()} />;
}
