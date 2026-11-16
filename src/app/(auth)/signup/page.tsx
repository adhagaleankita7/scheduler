import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { getSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  const session = await getSessionContext();
  if (session) redirect("/dashboard");
  return <SignupForm />;
}
