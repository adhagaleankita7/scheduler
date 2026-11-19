/**
 * LinkedIn scope helpers shared by the OAuth flow, target builder and UI.
 *
 * Keeping them in one place avoids the classic bug where the connect flow
 * accepts `rw_organization_admin` but the target picker only checks
 * `r_organization_admin` (or vice versa).
 */

export const LINKEDIN_MEMBER_SCOPE = "w_member_social";
export const LINKEDIN_ORG_PUBLISH_SCOPE = "w_organization_social";
export const LINKEDIN_ORG_ADMIN_SCOPES = [
  "r_organization_admin",
  "rw_organization_admin",
] as const;

/** Scopes any approved app can request: sign-in + personal posting. */
export const LINKEDIN_PERSONAL_SCOPES = [
  "openid",
  "profile",
  "email",
  LINKEDIN_MEMBER_SCOPE,
] as const;

export function hasScope(scopes: readonly string[] | null | undefined, scope: string) {
  return Boolean(scopes?.includes(scope));
}

/**
 * True for scopes that are gated behind the Community Management API approval.
 * Requesting one of these before LinkedIn approves it makes the *entire*
 * authorization fail with `invalid_scope`, which is why the OAuth flow retries
 * with personal scopes only instead of dead-ending.
 */
export function isOrganizationGatedScope(scope: string) {
  return (
    scope === LINKEDIN_ORG_PUBLISH_SCOPE ||
    (LINKEDIN_ORG_ADMIN_SCOPES as readonly string[]).includes(scope)
  );
}

/** Split a requested scope list into personal and approval-gated organization scopes. */
export function splitRequestedScopes(scopes: readonly string[]) {
  const personal: string[] = [];
  const organization: string[] = [];
  for (const scope of scopes) {
    (isOrganizationGatedScope(scope) ? organization : personal).push(scope);
  }
  return { personal, organization };
}

/** The same request minus org scopes — the safe fallback when approval is pending. */
export function personalOnlyScopes(scopes: readonly string[]) {
  return splitRequestedScopes(scopes).personal;
}

/**
 * LinkedIn reports a scope rejection with more than one code: `invalid_scope`
 * from the token endpoint and `unauthorized_scope_error` on the authorization
 * endpoint (the "Bummer, something went wrong" page). Treat both as the same
 * condition so a pending Community Management API approval always degrades to
 * personal publishing instead of a dead end.
 */
export function isScopeRejection(providerError: string | null | undefined) {
  if (!providerError) return false;
  return /^(?:invalid|unauthorized)_scope(?:_error)?$/i.test(providerError.trim());
}

/**
 * LinkedIn rejected the authorization with a scope error while org scopes were
 * requested. Retrying with personal scopes keeps sign-in and personal posting
 * working, and the app picks up page access automatically after approval.
 */
export function shouldRetryWithoutOrganizationScopes(
  requestedScopes: readonly string[],
  providerError: string | null | undefined,
) {
  return (
    isScopeRejection(providerError) &&
    splitRequestedScopes(requestedScopes).organization.length > 0
  );
}

/** True when the token can list pages and read the member's admin role. */
export function hasOrganizationAdminScope(scopes: readonly string[] | null | undefined) {
  return LINKEDIN_ORG_ADMIN_SCOPES.some((scope) => hasScope(scopes, scope));
}

/** True when the token can create organization posts. */
export function hasOrganizationPublishScope(scopes: readonly string[] | null | undefined) {
  return hasScope(scopes, LINKEDIN_ORG_PUBLISH_SCOPE);
}
