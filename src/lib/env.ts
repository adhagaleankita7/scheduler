/**
 * Central environment configuration.
 *
 * All values are read lazily so that `next build` works without secrets.
 * Never import this module into a Client Component unless the variable is
 * explicitly public (NEXT_PUBLIC_*).
 */

export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

/**
 * Supabase's public client key. Newer projects issue a publishable key
 * (`sb_publishable_…`); older projects use the anon JWT. Support both names so
 * either dashboard value works without code changes.
 */
export function getSupabasePublicKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

export function getSupabaseAnonKey() {
  return getSupabasePublicKey();
}

export function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function isServiceRoleConfigured() {
  return Boolean(getSupabaseUrl() && getServiceRoleKey());
}

export function isLinkedInConfigured() {
  return Boolean(
    process.env.LINKEDIN_CLIENT_ID?.trim() &&
      process.env.LINKEDIN_CLIENT_SECRET?.trim(),
  );
}

/** Mock publishing is always opt-in and can never be enabled in production builds. */
export function isLinkedInMockMode() {
  return (
    process.env.LINKEDIN_MOCK_MODE === "true" &&
    process.env.NEXT_PUBLIC_VERCEL_ENV !== "production" &&
    process.env.NODE_ENV !== "production"
  );
}

/** Development-only UI fixture mode. Hard-disabled in production. */
export function isDemoMode() {
  return (
    process.env.LINKFLOW_DEMO_MODE === "1" && process.env.NODE_ENV !== "production"
  );
}

export function getAppUrl() {
  // `??` would keep an empty NEXT_PUBLIC_APP_URL, producing relative OAuth
  // redirects like "/api/linkedin/callback". Fall through to the deployment URL
  // (or localhost) whenever the configured value is blank.
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

/**
 * Scopes requested from LinkedIn. The default is the self-serve set that any
 * approved app can request without Community Management API review, so personal
 * publishing works on a fresh install.
 *
 * Adding `w_organization_social r_organization_admin` before LinkedIn approves
 * the Community Management API makes LinkedIn reject the *entire*
 * authorization with `invalid_scope`, including personal access. Only add them
 * after approval — see docs/LINKEDIN_APPROVAL.md.
 */
export function getLinkedInScopes() {
  return (
    process.env.LINKEDIN_SCOPES?.trim() ||
    "openid profile email w_member_social"
  );
}

/** Parsed scope list, tolerant of commas, spaces and newlines. */
export function getLinkedInScopeList() {
  return getLinkedInScopes()
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function getLinkedInApiVersion() {
  // LinkedIn supports the current version plus the previous eleven monthly
  // versions. Bump this when LinkedIn announces a retirement.
  return process.env.LINKEDIN_API_VERSION?.trim() || "202610";
}

export function getCronSecret() {
  return process.env.CRON_SECRET?.trim() ?? "";
}

export function getFunctionUrl() {
  if (process.env.SUPABASE_FUNCTION_URL) {
    return process.env.SUPABASE_FUNCTION_URL.replace(/\/$/, "");
  }
  const base = getSupabaseUrl();
  return base ? `${base}/functions/v1` : "";
}

export const APP_NAME = "LINKFLOW";
