"use client";

import { useActionState } from "react";
import { Github, Linkedin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signInWithOAuthAction, type AuthState } from "@/lib/auth/actions";
import {
  OAUTH_PROVIDERS,
  getEnabledOAuthProviders,
  type OAuthProvider,
} from "@/lib/auth/providers";
import { cn } from "@/lib/utils";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z"
      />
    </svg>
  );
}

function ProviderIcon({ provider }: { provider: OAuthProvider }) {
  if (provider === "google") return <GoogleIcon />;
  if (provider === "github") return <Github className="size-4" />;
  return <Linkedin className="size-4" />;
}

function OAuthButton({ provider, next }: { provider: OAuthProvider; next?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signInWithOAuthAction,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Button type="submit" variant="outline" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ProviderIcon provider={provider} />
        )}
        {pending ? "Redirecting…" : `Continue with ${OAUTH_PROVIDERS[provider].label}`}
      </Button>
      {state.error && <p className="mt-1.5 text-[11px] text-destructive">{state.error}</p>}
    </form>
  );
}

/**
 * Renders the configured social sign-in buttons plus a divider. Returns
 * nothing when `NEXT_PUBLIC_AUTH_PROVIDERS` is empty or `none`, so the email
 * form stays flush without an orphaned separator.
 */
export function OAuthButtons({
  next,
  dividerLabel = "or continue with email",
  className,
}: {
  next?: string;
  dividerLabel?: string;
  className?: string;
}) {
  const providers = getEnabledOAuthProviders();
  if (providers.length === 0) return null;

  return (
    <div className={cn("mb-5", className)}>
      <div className="space-y-2">
        {providers.map((provider) => (
          <OAuthButton key={provider} provider={provider} next={next} />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
          {dividerLabel}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
