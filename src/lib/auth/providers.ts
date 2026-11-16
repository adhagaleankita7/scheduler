/**
 * Social sign-in providers supported by Supabase Auth.
 *
 * Each provider must be enabled in the Supabase dashboard (Authentication →
 * Providers) before its button works. The UI only renders the providers listed
 * in `NEXT_PUBLIC_AUTH_PROVIDERS`, which defaults to Google so a fresh install
 * does not offer a button that always fails.
 */
export const OAUTH_PROVIDER_IDS = ["google", "github", "linkedin_oidc"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDER_IDS)[number];

export const OAUTH_PROVIDERS: Record<OAuthProvider, { label: string }> = {
  google: { label: "Google" },
  github: { label: "GitHub" },
  linkedin_oidc: { label: "LinkedIn" },
};

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return (
    typeof value === "string" &&
    (OAUTH_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/**
 * Parse a `NEXT_PUBLIC_AUTH_PROVIDERS` value.
 *
 * - `undefined` → the default (`google`)
 * - empty string or `none` → no provider buttons
 * - `google,github` → both, unknown values ignored, duplicates removed
 */
export function parseOAuthProviders(raw: string | undefined): OAuthProvider[] {
  if (raw === undefined) return ["google"];

  const tokens = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0 || tokens.includes("none")) return [];

  const enabled = new Set<OAuthProvider>();
  for (const token of tokens) {
    if (isOAuthProvider(token)) enabled.add(token);
  }
  return [...enabled];
}

/**
 * Providers to render on /login and /signup. `NEXT_PUBLIC_*` values are
 * inlined into the client bundle at build time, so changing this variable
 * requires a rebuild.
 */
export function getEnabledOAuthProviders(): OAuthProvider[] {
  return parseOAuthProviders(process.env.NEXT_PUBLIC_AUTH_PROVIDERS);
}
