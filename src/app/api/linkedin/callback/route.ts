import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getLinkedInScopeList,
  isServiceRoleConfigured,
  isSupabaseConfigured,
} from "@/lib/env";
import {
  LinkedInOAuthError,
  exchangeCodeForToken,
  fetchLinkedInProfile,
  fetchOrganizationAccess,
  getLinkedInRedirectUri,
  parseScopeList,
  resolveGrantedScopes,
} from "@/lib/linkedin/oauth";
import {
  hasOrganizationAdminScope,
  hasOrganizationPublishScope,
  isScopeRejection,
  shouldRetryWithoutOrganizationScopes,
  splitRequestedScopes,
} from "@/lib/linkedin/scopes";
import { resolveRequestOrigin } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

function failure(origin: string, message: string) {
  return NextResponse.redirect(
    new URL(`/accounts?error=${encodeURIComponent(message)}`, origin),
  );
}

export async function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const errorDescription = request.nextUrl.searchParams.get("error_description");

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/setup", origin));
  }

  if (oauthError) {
    if (isScopeRejection(oauthError)) {
      // Organization scopes are gated behind Community Management API approval.
      // When this attempt asked for them, retry once with personal scopes so
      // sign-in and personal posting keep working while LinkedIn reviews the
      // app. The state row records what was requested, which also acts as the
      // loop guard: the retried attempt stores personal scopes only.
      if (state && isServiceRoleConfigured()) {
        const admin = createAdminClient();
        const { data: stateRow } = await admin
          .from("oauth_states")
          .select("id, scopes")
          .eq("state", state)
          .eq("provider", "linkedin")
          .maybeSingle();
        const attemptedScopes = parseScopeList(stateRow?.scopes);
        if (
          stateRow &&
          shouldRetryWithoutOrganizationScopes(attemptedScopes, oauthError)
        ) {
          await admin.from("oauth_states").delete().eq("id", stateRow.id);
          console.info(
            "LinkedIn rejected organization scopes; retrying with personal scopes only",
          );
          return NextResponse.redirect(
            new URL("/api/linkedin/connect?scopes=member", origin),
          );
        }
      }
      return failure(
        origin,
        "LinkedIn rejected one or more requested permissions. Keep LINKEDIN_SCOPES to `openid profile email w_member_social` for personal publishing, and add `w_organization_social r_organization_admin` only after the Community Management API is approved for your app.",
      );
    }
    return failure(
      origin,
      errorDescription || "LinkedIn access was cancelled. Nothing was connected.",
    );
  }
  if (!code || !state) {
    return failure(origin, "LinkedIn returned an incomplete authorization response.");
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/accounts&reason=session", origin));
  }

  if (!isServiceRoleConfigured()) {
    return failure(
      origin,
      "LinkedIn could not be connected because SUPABASE_SERVICE_ROLE_KEY is not configured on the server. Add it to the hosting environment and try again.",
    );
  }

  const admin = createAdminClient();

  // Atomically consume the single-use state record.
  const { data: stateRow, error: stateError } = await admin
    .from("oauth_states")
    .delete()
    .eq("state", state)
    .eq("user_id", user.id)
    .eq("provider", "linkedin")
    .select("id, expires_at, scopes, workspace_id")
    .maybeSingle();

  if (stateError || !stateRow) {
    return failure(origin, "This LinkedIn connection request is invalid or was already used. Start again.");
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    return failure(origin, "The LinkedIn connection request expired. Start again.");
  }

  // Older state rows have no workspace recorded; fall back to the profile's
  // active workspace so the new account still lands in the right place.
  let workspaceId = stateRow.workspace_id;
  if (!workspaceId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("active_workspace_id")
      .eq("id", user.id)
      .maybeSingle();
    workspaceId = profile?.active_workspace_id ?? null;
  }
  if (!workspaceId) {
    return failure(origin, "No active workspace was found for this connection. Open the workspace and try again.");
  }

  try {
    // Use the same redirect URI that was sent in the authorization request.
    // LinkedIn rejects the token exchange if the two differ by even a slash.
    const redirectUri = getLinkedInRedirectUri(origin);
    const token = await exchangeCodeForToken(code, redirectUri);
    const profile = await fetchLinkedInProfile(token.access_token);

    // LinkedIn normally echoes the granted scopes. If a response omits them,
    // fall back to the scopes this attempt actually requested (which may be the
    // personal-only fallback list) so a valid token is not misread as "missing
    // w_member_social" and blocked by the target picker/publisher.
    const attemptedScopes = parseScopeList(stateRow.scopes);
    const requestedScopes =
      attemptedScopes.length > 0 ? attemptedScopes : getLinkedInScopeList();
    const scopes = resolveGrantedScopes(token.scope, requestedScopes);

    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;
    const refreshExpiresAt = token.refresh_token_expires_in
      ? new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString()
      : null;

    const { data: account, error: upsertError } = await admin
      .from("social_accounts")
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: user.id,
          provider: "linkedin",
          provider_account_id: profile.sub,
          display_name: profile.name || "LinkedIn member",
          avatar_url: profile.picture,
          email: profile.email,
          scopes,
          status: "connected",
          token_expires_at: expiresAt,
          refresh_token_expires_at: refreshExpiresAt,
          last_refreshed_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "workspace_id,provider,provider_account_id" },
      )
      .select("id")
      .single();

    if (upsertError || !account) {
      throw new LinkedInOAuthError(
        "The LinkedIn account could not be saved. Please try again.",
        "account_save_failed",
      );
    }

    const { error: tokenStoreError } = await admin.rpc("store_social_tokens", {
      p_account_id: account.id,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token ?? null,
      p_access_expires_at: expiresAt,
      p_refresh_expires_at: refreshExpiresAt,
      p_scopes: scopes,
    });
    if (tokenStoreError) {
      // Remove the half-connected account so tokens and metadata never drift.
      await admin.from("social_accounts").delete().eq("id", account.id);
      throw new LinkedInOAuthError(
        "LinkedIn credentials could not be stored securely. Check that Supabase Vault is enabled.",
        "vault_store_failed",
      );
    }

    const { organizations, warning, complete } = await fetchOrganizationAccess(
      token.access_token,
      scopes,
    );

    let pageSyncError: string | null = null;
    if (organizations.length > 0) {
      const { error: pageError } = await admin.from("social_pages").upsert(
        organizations.map((organization) => ({
          workspace_id: workspaceId,
          user_id: user.id,
          social_account_id: account.id,
          provider: "linkedin",
          provider_page_id: organization.id,
          name: organization.name,
          vanity_name: organization.vanityName,
          logo_url: organization.logoUrl,
          role: organization.role,
          can_publish: organization.canPublish,
          status: organization.state,
        })),
        { onConflict: "workspace_id,provider,provider_page_id" },
      );
      if (pageError) pageSyncError = pageError.message;
    }

    // A successful ACL read is authoritative: drop pages the member no longer
    // administers (role removed, page deleted, or a different LinkedIn member
    // reconnected the account). Never prune after a failed/partial read.
    if (complete && !pageSyncError) {
      const currentIds = organizations.map((organization) => organization.id);
      let prune = admin
        .from("social_pages")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("social_account_id", account.id)
        .eq("provider", "linkedin");
      if (currentIds.length > 0) {
        prune = prune.not(
          "provider_page_id",
          "in",
          `(${currentIds.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`,
        );
      }
      const { error: pruneError } = await prune;
      if (pruneError) pageSyncError = pruneError.message;
    }

    const pending = organizations.filter((organization) => !organization.canPublish).length;

    // Company-page scopes are approval-gated. Say exactly what happened when the
    // connection ended up personal-only, so nobody wonders why pages are empty.
    const configuredOrgScopes = splitRequestedScopes(getLinkedInScopeList()).organization;
    const attemptedOrgScopes = splitRequestedScopes(requestedScopes).organization;
    const orgScopesPending = configuredOrgScopes.length > 0 && attemptedOrgScopes.length === 0;
    const orgScopesNotGranted =
      configuredOrgScopes.length > 0 &&
      (!hasOrganizationPublishScope(scopes) || !hasOrganizationAdminScope(scopes));

    const notice =
      pageSyncError
        ? `Your LinkedIn profile is connected, but company pages could not be refreshed (${pageSyncError}). Reconnect from Accounts to retry.`
        : warning ??
          (orgScopesPending
            ? "Connected with personal permissions only: LinkedIn has not approved company-page access (Community Management API) for this app yet. Personal and company-page scheduling is ready the moment it is approved — then click Reconnect on Accounts to pick up the organization scopes."
            : orgScopesNotGranted
              ? "Connected, but LinkedIn did not grant the company-page permissions (w_organization_social / r_organization_admin). Personal posting works now; reconnect after the app is approved to unlock page publishing."
              : pending > 0
                ? `${organizations.length} page${organizations.length === 1 ? "" : "s"} connected. ${pending} need a Super Admin/Content Admin role or org API approval before LINKFLOW can publish to them.`
                : null);

    const params = new URLSearchParams({ connected: "1" });
    if (notice) params.set("notice", notice);
    return NextResponse.redirect(new URL(`/accounts?${params.toString()}`, origin));
  } catch (error) {
    const message =
      error instanceof LinkedInOAuthError
        ? error.message
        : "LinkedIn could not be connected. Check server logs and try again.";
    console.error("LinkedIn callback failed", error);
    return failure(origin, message);
  }
}
