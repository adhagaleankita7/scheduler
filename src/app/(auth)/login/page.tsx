import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  password_updated: "Your password was updated. Sign in with your new password.",
  session: "Your session expired. Please sign in again.",
  confirmed: "Email confirmed. You can sign in now.",
  link_expired: "That sign-in link is invalid or has expired. Request a new one below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const session = await getSessionContext();
  if (session) redirect("/dashboard");

  const params = await searchParams;
  const next = safeNextPath(params.next, "") || undefined;
  const notice = params.reason ? NOTICES[params.reason] : undefined;

  return <LoginForm next={next} notice={notice} />;
}
