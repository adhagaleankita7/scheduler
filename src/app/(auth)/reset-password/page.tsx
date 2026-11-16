import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  if (!isSupabaseConfigured()) {
    redirect("/setup");
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-amber-500/12 text-amber-500">
          <ShieldAlert className="size-6" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.03em]">Reset link expired</h1>
        <p className="text-muted-foreground mt-2 text-[12.5px] leading-relaxed">
          Password reset links are single-use and expire after one hour. Request a new one and we
          will email you a fresh link.
        </p>
        <Button asChild variant="gradient" className="mt-6 w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return <ResetPasswordForm email={user.email ?? null} />;
}
