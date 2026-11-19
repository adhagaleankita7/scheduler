import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";
import { isServiceRoleConfigured, isSupabaseConfigured } from "@/lib/env";
import {
  FacebookOAuthError,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchFacebookPages,
  fetchFacebookProfile,
  fetchGrantedScopes,
  getFacebookRedirectUri,
} from "@/lib/facebook/oauth";
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
    return failure(
      origin,
      errorDescription ||
        (oauthError === "access_denied"
          ? "Facebook access was cancelled. Nothing was connected."
          : "Facebook rejected the connection request. Check the app's Valid OAuth Redirect URIs and requested permissions."),
    );
  }
  if (!code || !state) {
    return failure(origin, "Facebook returned an incomplete authorization response.");
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/accounts&reason=session", origin));
  }

  if (!isServiceRoleConfigured()) {
    return failure(
      origin,
      "Facebook could not be connected because SUPABASE_SERVICE_ROLE_KEY is not configured on the server. Add it to the hosting environment and try again.",
    );
  }

  const admin = createAdminClient();

  // Atomically consume the single-use state record, scoped to this provider so
  // a LinkedIn attempt can never be reused for Facebook.
  const { data: stateRow, error: stateError } = await admin
    .from("oauth_states")
    .delete()
    .eq("state", state)
    .eq("user_id", user.id)
    .eq("provider", "facebook")
    .select("id, expires_at, scopes, workspace_id")
    .maybeSingle();

  if (stateError || !stateRow) {
    return failure(origin, "This Facebook connection request is invalid or was already used. Start again.");
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    return failure(origin, "The Facebook connection request expired. Start again.");
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
    // Facebook requires the exact redirect_uri used in the authorization
    // request during the token exchange.
    const redirectUri = getFacebookRedirectUri(origin);
    const shortToken = await exchangeCodeForToken(code, redirectUri);
    const longToken = await exchangeForLongLivedToken(shortToken.access_token);
    const accessToken = longToken.access_token;
    const expiresIn = longToken.expires_in ?? shortToken.expires_in;

    const profile = await fetchFacebookProfile(accessToken);
    const { pages, warning, complete } = await fetchFacebookPages(accessToken);

    // Store what Facebook actually granted, not what we asked for. Otherwise the
    // Accounts page claims page publishing works while the worker gets a #200
    // permission error at publish time.
    const requestedScopes = (stateRow.scopes ?? "").split(/[\s,]+/).filter(Boolean);
    const grantedScopes = await fetchGrantedScopes(accessToken);
    const scopes = grantedScopes.length > 0 ? grantedScopes : requestedScopes;

    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const { data: account, error: upsertError } = await admin
      .from("social_accounts")
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: user.id,
          provider: "facebook",
          provider_account_id: profile.id,
          display_name: profile.name || "Facebook member",
          avatar_url: profile.picture,
          email: profile.email,
          scopes,
          status: "connected",
          token_expires_at: expiresAt,
          refresh_token_expires_at: null,
          last_refreshed_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "workspace_id,provider,provider_account_id" },
      )
      .select("id")
      .single();

    if (upsertError || !account) {
      throw new FacebookOAuthError(
        "The Facebook account could not be saved. Please try again.",
        "account_save_failed",
      );
    }

    const { error: tokenStoreError } = await admin.rpc("store_social_tokens", {
      p_account_id: account.id,
      p_access_token: accessToken,
      p_refresh_token: null,
      p_access_expires_at: expiresAt,
      p_refresh_expires_at: null,
      p_scopes: scopes,
    });
    if (tokenStoreError) {
      await admin.from("social_accounts").delete().eq("id", account.id);
      throw new FacebookOAuthError(
        "Facebook credentials could not be stored securely. Check that Supabase Vault is enabled.",
        "vault_store_failed",
      );
    }

    let pageSyncError: string | null = null;
    if (pages.length > 0) {
      const { error: pageError } = await admin.from("social_pages").upsert(
        pages.map((page) => ({
          workspace_id: workspaceId,
          user_id: user.id,
          social_account_id: account.id,
          provider: "facebook",
          provider_page_id: page.id,
          name: page.name,
          vanity_name: page.username,
          logo_url: page.picture,
          page_type: "facebook_page",
          role: page.tasks.join(", "),
          can_publish: page.canPublish,
          status: "active",
        })),
        { onConflict: "workspace_id,provider,provider_page_id" },
      );
      if (pageError) pageSyncError = pageError.message;
    }

    // A successful read is authoritative: drop Pages the member no longer
    // manages. Never prune after a failed/partial read.
    if (complete && !pageSyncError) {
      const currentIds = pages.map((page) => page.id);
      let prune = admin
        .from("social_pages")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("social_account_id", account.id)
        .eq("provider", "facebook");
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

    const publishable = pages.filter((page) => page.canPublish).length;
    const missingPublishScope = !scopes.includes("pages_manage_posts");

    const notice = pageSyncError
      ? `Your Facebook profile is connected, but Pages could not be refreshed (${pageSyncError}). Reconnect from Accounts to retry.`
      : warning ??
        (pages.length > 0 && publishable === 0
          ? `${pages.length} Facebook Page${pages.length === 1 ? "" : "s"} connected, but none grant content-creation access. Ask a Page admin for an Editor/Admin role, then reconnect.`
          : missingPublishScope
            ? "Connected, but Facebook did not grant pages_manage_posts, so publishing will fail. Remove LINKFLOW from facebook.com/settings?tab=applications and connect again, keeping the content-creation permission enabled."
            : null);

    const params = new URLSearchParams({ connected: "1", provider: "facebook" });
    if (notice) params.set("notice", notice);
    return NextResponse.redirect(new URL(`/accounts?${params.toString()}`, origin));
  } catch (error) {
    const message =
      error instanceof FacebookOAuthError
        ? error.message
        : "Facebook could not be connected. Check server logs and try again.";
    console.error("Facebook callback failed", error);
    return failure(origin, message);
  }
}
