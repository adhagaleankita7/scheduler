"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MailCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordAction, type AuthState } from "@/lib/auth/actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    forgotPasswordAction,
    {},
  );

  if (state.message) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-emerald-500/12 text-emerald-500">
          <MailCheck className="size-6" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.03em]">Check your email</h1>
        <p className="text-muted-foreground mt-2 text-[12.5px] leading-relaxed">{state.message}</p>
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-7">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
          Account recovery
        </p>
        <h1 className="font-display mt-2 text-[28px] font-bold tracking-[-0.035em]">
          Reset your password
        </h1>
        <p className="text-muted-foreground mt-2 text-[12.5px] leading-relaxed">
          Enter the email you signed up with and we&apos;ll send a secure, single-use reset link.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
          />
        </div>

        {state.error && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-[12px] text-destructive">
            {state.error}
          </div>
        )}

        <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <Link
        href="/login"
        className="text-muted-foreground mt-6 inline-flex items-center gap-1.5 text-[12px] transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to sign in
      </Link>
    </div>
  );
}
