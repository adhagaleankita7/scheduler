import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getLinkedInScopeList,
  isLinkedInConfigured,
  isLinkedInMockMode,
  isServiceRoleConfigured,
  isSupabaseConfigured,
} from "@/lib/env";
import {
  buildAuthorizationUrl,
  generateState,
  getLinkedInRedirectUri,
  probeAuthorizationRequest,
} from "@/lib/linkedin/oauth";
import {
  personalOnlyScopes,
  shouldRetryWithoutOrganizationScopes,
} from "@/lib/linkedin/scopes";
import {
  buildMockAccessToken,
  buildMockLinkedInAccount,
  mockDisplayName,
} from "@/lib/linkedin/mock-account";
import { resolveRequestOrigin } from "@/lib/http/origin";
import { getSessionContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // The browser's real origin (tunnel/proxy aware), used for post-OAuth
  // redirects. The OAuth redirect URI is resolved separately so it always
  // matches what is registered in the LinkedIn app.
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
        "/accounts?error=SUPABASE_SERVICE_ROLE_KEY%20is%20not%20configured%2C%20so%20LinkedIn%20cannot%20be%20connected%20securely.",
        origin,
      ),
    );
  }

  try {
    const admin = createAdminClient();

    // Local development without a LinkedIn app: create a clearly-labelled mock
    // account so the queue, cron pipeline and publisher can be exercised. This
    // branch is unreachable in production (isLinkedInMockMode is hard-disabled).
    if (!isLinkedInConfigured() && isLinkedInMockMode()) {
      const scopes = getLinkedInScopeList();
      const accountPayload = buildMockLinkedInAccount({
        userId: user.id,
        displayName: mockDisplayName(user),
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
          accountError?.message ?? "The mock LinkedIn account could not be saved.",
        );
      }

      const { error: tokenError } = await admin.rpc("store_social_tokens", {
        p_account_id: account.id,
        p_access_token: buildMockAccessToken(),
        p_refresh_token: null,
        p_access_expires_at: accountPayload.token_expires_at,
        p_refresh_expires_at: null,
        p_scopes: scopes,
      });
      if (tokenError) {
        await admin.from("social_accounts").delete().eq("id", account.id);
        throw new Error(
          `Mock LinkedIn credentials could not be stored: ${tokenError.message}`,
        );
      }

      const params = new URLSearchParams({
        connected: "1",
        mock: "1",
        notice:
          "Mock LinkedIn account connected. Publishing is simulated, stored with is_mock = true, and never sent to LinkedIn.",
      });
      return NextResponse.redirect(
        new URL(`/accounts?${params.toString()}`, origin),
      );
    }

    if (!isLinkedInConfigured()) {
      return NextResponse.redirect(
        new URL(
          "/accounts?error=LinkedIn%20OAuth%20is%20not%20configured%20on%20the%20server",
          origin,
        ),
      );
    }

    const redirectUri = getLinkedInRedirectUri(origin);

    // Company-page scopes are approval-gated. Requesting them before LinkedIn
    // approves the Community Management API makes LinkedIn reject the whole
    // authorization, which would also break personal posting. The callback (and
    // the pre-flight probe below) retry this route with `?scopes=member`, so a
    // pending approval degrades to a personal-only connection instead of a
    // dead end. The browser is sent back here automatically, once.
    const personalOnlyRequested =
      request.nextUrl.searchParams.get("scopes") === "member";
    const requestedScopes = personalOnlyRequested
      ? personalOnlyScopes(getLinkedInScopeList())
      : getLinkedInScopeList();
    const requestedScopeString = requestedScopes.join(" ");

    // LinkedIn checks the redirect URL on its own page, before consent. Without
    // this pre-flight the member lands on a dead-end "Bummer, something went
    // wrong" page and the app never sees the error. Probe first so the failure
    // becomes an actionable message on /accounts instead of a silent no-op.
    const probe = await probeAuthorizationRequest({
      redirectUri,
      scopes: requestedScopeString,
    });
    if (!probe.ok && probe.blocking) {
      if (
        !personalOnlyRequested &&
        shouldRetryWithoutOrganizationScopes(requestedScopes, probe.code)
      ) {
        console.info(
          "LinkedIn rejected organization scopes; retrying with personal scopes only",
        );
        return NextResponse.redirect(
          new URL("/api/linkedin/connect?scopes=member", origin),
        );
      }
      const detail =
        probe.code === "redirect_uri_mismatch"
          ? `LinkedIn refused the connection because the callback URL "${redirectUri}" is not registered on this LinkedIn app. Open https://www.linkedin.com/developers/apps → your app → Auth → Authorized redirect URLs, add that exact URL, save, then click Connect LinkedIn again. Quick-tunnel URLs change on every restart, so a stable HTTPS domain is needed for reliable daily publishing.`
          : probe.code === "invalid_scope"
            ? `${probe.detail} Check LINKEDIN_SCOPES: keep \`openid profile email w_member_social\`, and add \`w_organization_social r_organization_admin\` only once LinkedIn approves the Community Management API.`
            : probe.detail;
      console.error("LinkedIn connect blocked by pre-flight check", {
        code: probe.code,
        redirectUri,
      });
      return NextResponse.redirect(
        new URL(`/accounts?error=${encodeURIComponent(detail)}`, origin),
      );
    }
    if (!probe.ok) {
      // Network hiccup on the server; let the browser try anyway.
      console.warn("LinkedIn pre-flight probe unavailable", probe.detail);
    }

    const state = generateState();

    // Clean up stale states for this user, then persist the new single-use state.
    await admin
      .from("oauth_states")
      .delete()
      .eq("user_id", user.id)
      .lt("expires_at", new Date().toISOString());

    // `code_verifier` stays null on purpose: LinkedIn rejects the token
    // exchange with invalid_client when PKCE is used (see oauth.ts).
    // `scopes` records what this attempt actually asked for, so the callback
    // resolves granted scopes against the right list after a fallback retry.
    const { error } = await admin.from("oauth_states").insert({
      user_id: user.id,
      workspace_id: workspaceId,
      state,
      code_verifier: null,
      scopes: requestedScopeString,
      provider: "linkedin",
      return_to: "/accounts",
    });
    if (error) throw new Error(error.message);

    // Never log the client secret or verifier. The redirect URI and client id
    // are public and are the two values that must match between the
    // authorization request and the token exchange.
    console.info("LinkedIn OAuth started", {
      redirectUri,
      clientId: process.env.LINKEDIN_CLIENT_ID?.trim() || null,
      scopes: requestedScopeString,
      personalOnly: personalOnlyRequested,
    });

    return NextResponse.redirect(
      buildAuthorizationUrl(state, redirectUri, requestedScopeString),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not start LinkedIn authorization.";
    console.error("LinkedIn connect failed", message);
    return NextResponse.redirect(
      new URL(`/accounts?error=${encodeURIComponent(message)}`, origin),
    );
  }
}
