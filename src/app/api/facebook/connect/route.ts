import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getFacebookScopeList,
  isFacebookConfigured,
  isFacebookMockMode,
  isServiceRoleConfigured,
  isSupabaseConfigured,
} from "@/lib/env";
import {
  buildFacebookAuthorizationUrl,
  getFacebookRedirectUri,
} from "@/lib/facebook/oauth";
import {
  buildMockFacebookAccount,
  buildMockFacebookPage,
  buildMockFacebookToken,
  mockFacebookDisplayName,
} from "@/lib/facebook/mock-account";
import { generateState } from "@/lib/linkedin/oauth";
import { resolveRequestOrigin } from "@/lib/http/origin";
import { getSessionContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/setup", origin));
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/accounts", origin));
  }

  const session = await getSessionContext();
  const workspaceId = session?.workspace.id;
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL("/accounts?error=No%20active%20workspace%20was%20found.", origin),
    );
  }

  if (!isServiceRoleConfigured()) {
    return NextResponse.redirect(
      new URL(
        "/accounts?error=SUPABASE_SERVICE_ROLE_KEY%20is%20not%20configured%2C%20so%20Facebook%20cannot%20be%20connected%20securely.",
        origin,
      ),
    );
  }

  try {
    const admin = createAdminClient();

    // Local development without a Meta app: create a labelled mock account so
    // the scheduler and publisher can be exercised end to end. Unreachable in
    // production because isFacebookMockMode() is hard-disabled there.
    if (!isFacebookConfigured() && isFacebookMockMode()) {
      const scopes = getFacebookScopeList();
      const accountPayload = buildMockFacebookAccount({
        userId: user.id,
        displayName: mockFacebookDisplayName(user),
        email: user.email ?? null,
        scopes,
      });

      const { data: account, error: accountError } = await admin
        .from("social_accounts")
        .upsert(
          { ...accountPayload, workspace_id: workspaceId },
          { onConflict: "workspace_id,provider,provider_account_id" },
        )
        .select("id")
        .single();
      if (accountError || !account) {
        throw new Error(
          accountError?.message ?? "The mock Facebook account could not be saved.",
        );
      }

      const { error: tokenError } = await admin.rpc("store_social_tokens", {
        p_account_id: account.id,
        p_access_token: buildMockFacebookToken(),
        p_refresh_token: null,
        p_access_expires_at: accountPayload.token_expires_at,
        p_refresh_expires_at: null,
        p_scopes: scopes,
      });
      if (tokenError) {
        await admin.from("social_accounts").delete().eq("id", account.id);
        throw new Error(
          `Mock Facebook credentials could not be stored: ${tokenError.message}`,
        );
      }

      const page = buildMockFacebookPage({ userId: user.id, accountId: account.id });
      const { error: pageError } = await admin.from("social_pages").upsert(
        {
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
        },
        { onConflict: "workspace_id,provider,provider_page_id" },
      );
      if (pageError) {
        throw new Error(`The mock Facebook Page could not be saved: ${pageError.message}`);
      }

      const params = new URLSearchParams({
        connected: "1",
        provider: "facebook",
        mock: "1",
        notice:
          "Mock Facebook account connected. Publishing is simulated, stored with is_mock = true, and never sent to Meta.",
      });
      return NextResponse.redirect(
        new URL(`/accounts?${params.toString()}`, origin),
      );
    }

    if (!isFacebookConfigured()) {
      return NextResponse.redirect(
        new URL(
          "/accounts?error=Facebook%20OAuth%20is%20not%20configured%20on%20the%20server.%20Add%20FACEBOOK_APP_ID%20and%20FACEBOOK_APP_SECRET.",
          origin,
        ),
      );
    }

    const redirectUri = getFacebookRedirectUri(origin);
    const requestedScopes = getFacebookScopeList();
    const requestedScopeString = requestedScopes.join(",");
    const state = generateState();

    await admin
      .from("oauth_states")
      .delete()
      .eq("user_id", user.id)
      .lt("expires_at", new Date().toISOString());

    const { error } = await admin.from("oauth_states").insert({
      user_id: user.id,
      workspace_id: workspaceId,
      state,
      code_verifier: null,
      scopes: requestedScopeString,
      provider: "facebook",
      return_to: "/accounts",
    });
    if (error) throw new Error(error.message);

    console.info("Facebook OAuth started", {
      redirectUri,
      appId: process.env.FACEBOOK_APP_ID ? "configured" : null,
      scopes: requestedScopeString,
    });

    return NextResponse.redirect(
      buildFacebookAuthorizationUrl(state, redirectUri, requestedScopeString),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not start Facebook authorization.";
    console.error("Facebook connect failed", message);
    return NextResponse.redirect(
      new URL(`/accounts?error=${encodeURIComponent(message)}`, origin),
    );
  }
}
