"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, LogIn, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { signInAction, type AuthState } from "@/lib/auth/actions";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signInAction, {});
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div className="mb-7">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Welcome back</p>
        <h1 className="font-display mt-2 text-[28px] font-bold tracking-[-0.035em]">Sign in to LINKFLOW</h1>
        <p className="text-muted-foreground mt-2 text-[12.5px] leading-relaxed">
          Your queue kept publishing while you were away.
        </p>
      </div>

      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-[12px] text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      <OAuthButtons next={next} dividerLabel="or sign in with email" />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-[11px] font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              required
              className="pr-10"
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
          {state.fieldErrors?.password && (
            <p className="text-[11px] text-destructive">{state.fieldErrors.password}</p>
          )}
        </div>

        {state.error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-[12px] text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {state.error}
          </div>
        )}

        <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-[12px]">
        New to LINKFLOW?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Create a free account
        </Link>
      </p>
    </div>
  );
}
