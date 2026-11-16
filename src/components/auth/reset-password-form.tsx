"use client";

import { useActionState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePasswordAction, type AuthState } from "@/lib/auth/actions";

export function ResetPasswordForm({ email }: { email: string | null }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    updatePasswordAction,
    {},
  );

  return (
    <div>
      <div className="mb-7">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
          Almost there
        </p>
        <h1 className="font-display mt-2 text-[28px] font-bold tracking-[-0.035em]">
          Choose a new password
        </h1>
        <p className="text-muted-foreground mt-2 text-[12.5px] leading-relaxed">
          {email ? (
            <>
              Setting a new password for <span className="font-medium text-foreground">{email}</span>.
            </>
          ) : (
            "Set a new password for your LINKFLOW account."
          )}
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
          {state.fieldErrors?.password && (
            <p className="text-[11px] text-destructive">{state.fieldErrors.password}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat your password"
            required
            aria-invalid={Boolean(state.fieldErrors?.confirm)}
          />
          {state.fieldErrors?.confirm && (
            <p className="text-[11px] text-destructive">{state.fieldErrors.confirm}</p>
          )}
        </div>

        {state.error && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-[12px] text-destructive">
            {state.error}
          </div>
        )}

        <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </div>
  );
}
