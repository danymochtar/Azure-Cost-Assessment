import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionCookie, SESSION_COOKIE } from "@/lib/auth";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage(props: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await props.searchParams;
  const ck = await cookies();
  const session = verifySessionCookie(ck.get(SESSION_COOKIE)?.value);
  if (session) {
    redirect(next || "/");
  }
  return <RegisterForm next={next || "/"} />;
}
