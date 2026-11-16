"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { signUpAction, type AuthState } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

const RULES = [
  { label: "8+ characters", test: (value: string) => value.length >= 8 },
  { label: "A number", test: (value: string) => /\d/.test(value) },
  { label: "Upper & lowercase", test: (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value) },
];

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signUpAction, {});
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);

  const passed = useMemo(() => RULES.filter((rule) => rule.test(password)).length, [password]);
  const strengthLabel = ["Too weak", "Weak", "Good", "Strong"][passed] ?? "Too weak";

  if (state.message && !state.error) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-emerald-500/12 text-emerald-500">
          <CheckCircle2 className="size-6" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.03em]">Check your inbox</h1>
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
        <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Start free</p>
        <h1 className="font-display mt-2 text-[28px] font-bold tracking-[-0.035em]">Plan your first week</h1>
        <p className="text-muted-foreground mt-2 text-[12.5px] leading-relaxed">
          Seven posts, one sitting. No credit card required.
        </p>
      </div>

      <OAuthButtons dividerLabel="or sign up with email" />

      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            placeholder="Aarav Mehta"
            required
            aria-invalid={Boolean(state.fieldErrors?.fullName)}
          />
          {state.fieldErrors?.fullName && (
            <p className="text-[11px] text-destructive">{state.fieldErrors.fullName}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            aria-invalid={Boolean(state.fieldErrors?.email)}
          />
          {state.fieldErrors?.email && (
            <p className="text-[11px] text-destructive">{state.fieldErrors.email}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Create a strong password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="pr-10"
              aria-invalid={Boolean(state.fieldErrors?.password)}
            />
            <button
              type="button"
              onClick={() => setVisible((value) => !value)}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={visible ? "Hide password" : "Show password"}
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          <div className="pt-1">
            <div className="flex gap-1">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    index < passed
                      ? passed === 3
                        ? "bg-emerald-500"
                        : passed === 2
                          ? "bg-amber-500"
                          : "bg-red-400"
                      : "bg-border",
                  )}
                />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {RULES.map((rule) => {
                const active = rule.test(password);
                return (
                  <span
                    key={rule.label}
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px]",
                      active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                    )}
                  >
                    <span className={cn("size-1 rounded-full", active ? "bg-emerald-500" : "bg-border")} />
                    {rule.label}
                  </span>
                );
              })}
              {password && (
                <span className="ml-auto text-[10px] font-medium text-muted-foreground">{strengthLabel}</span>
              )}
            </div>
          </div>
          {state.fieldErrors?.password && (
            <p className="text-[11px] text-destructive">{state.fieldErrors.password}</p>
          )}
        </div>

        <div className="flex items-start gap-2.5">
          <Checkbox id="acceptTerms" name="acceptTerms" className="mt-0.5" required />
          <Label htmlFor="acceptTerms" className="text-muted-foreground text-[11.5px] leading-relaxed font-normal">
            I agree to the Terms of Service and Privacy Policy, and understand that LINKFLOW
            publishes through the official LinkedIn API.
          </Label>
        </div>
        {state.fieldErrors?.acceptTerms && (
          <p className="text-[11px] text-destructive">{state.fieldErrors.acceptTerms}</p>
        )}

        {state.error && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-[12px] text-destructive">
            {state.error}
          </div>
        )}

        <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {pending ? "Creating your workspace…" : "Create my workspace"}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-[12px]">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
