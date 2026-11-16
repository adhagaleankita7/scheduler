import { randomBytes } from "node:crypto";
import {
  getAppUrl,
  getLinkedInApiVersion,
  getLinkedInScopes,
} from "@/lib/env";
import {
  hasOrganizationAdminScope,
  hasOrganizationPublishScope,
} from "@/lib/linkedin/scopes";

export const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
export const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export class LinkedInOAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string = "oauth_error",
  ) {
    super(message);
    this.name = "LinkedInOAuthError";
  }
}

export type LinkedInTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

export type LinkedInProfile = {
  sub: string;
  name: string | null;
  picture: string | null;
  email: string | null;
};

export type LinkedInOrganization = {
  id: string;
  name: string;
  vanityName: string | null;
  logoUrl: string | null;
  role: string | null;
  state: string;
  canPublish: boolean;
};

export const LINKEDIN_CALLBACK_PATH = "/api/linkedin/callback";

/**
 * The callback URL must be identical in the authorization request, the token
 * exchange and the LinkedIn developer app. `origin` lets callers pass the
 * request's public origin (tunnel/proxy aware) instead of relying only on
 * NEXT_PUBLIC_APP_URL.
 *
 * LINKEDIN_REDIRECT_URI wins when set, which is useful for local OAuth over an
 * HTTPS tunnel while keeping NEXT_PUBLIC_APP_URL on `http://localhost:3000` so
 * Supabase email links keep working.
 */
export function getLinkedInRedirectUri(origin?: string) {
  const override = process.env.LINKEDIN_REDIRECT_URI?.trim();
  if (override) return override.replace(/\/+$/, "");
  const base = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    origin?.trim() ||
    getAppUrl()
  ).replace(/\/+$/, "");
  return `${base}${LINKEDIN_CALLBACK_PATH}`;
}

/**
 * LinkedIn only accepts HTTPS redirect URLs, even for local development.
 * Failing fast here is far clearer than a generic `redirect_uri` error from
 * LinkedIn's consent screen.
 */
export function isSecureRedirectUri(uri: string) {
  return /^https:\/\//i.test(uri);
}

/**
 * Validate a redirect URI before it is sent anywhere. A common setup mistake is
 * pointing LINKEDIN_REDIRECT_URI at `/auth/callback` (the Supabase Auth route)
 * instead of the LinkedIn route; LinkedIn would happily redirect there and the
 * code would never be exchanged.
 */
export function requireLinkedInRedirectUri(uri: string) {
  if (!isSecureRedirectUri(uri)) {
    throw new LinkedInOAuthError(
      `LinkedIn requires an HTTPS redirect URL, but this app would send "${uri}". Set NEXT_PUBLIC_APP_URL (or LINKEDIN_REDIRECT_URI) to your HTTPS deployment or a tunnel such as \`cloudflared tunnel --url http://localhost:3000\`, then register that exact URL as a redirect URL in the LinkedIn app.`,
      "insecure_redirect_uri",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new LinkedInOAuthError(
      `The LinkedIn redirect URL "${uri}" is not a valid absolute URL.`,
      "invalid_redirect_uri",
    );
  }

  if (parsed.pathname.replace(/\/+$/, "") !== LINKEDIN_CALLBACK_PATH) {
    throw new LinkedInOAuthError(
      `The LinkedIn redirect URL must end with ${LINKEDIN_CALLBACK_PATH}, but it points at ${parsed.pathname}. Update LINKEDIN_REDIRECT_URI (or unset it so NEXT_PUBLIC_APP_URL is used).`,
      "invalid_redirect_path",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new LinkedInOAuthError(
      `The LinkedIn redirect URL must not contain a query string or fragment: ${uri}`,
      "invalid_redirect_uri",
    );
  }

  return uri;
}

/** LinkedIn returns scopes as a space- or comma-separated string. */
export function parseScopeList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/**
 * Prefer the scopes LinkedIn echoed on the token response. Some valid token
 * responses omit `scope`; falling back to the requested list prevents a valid
 * token from being misread as missing `w_member_social` and blocked by the
 * publisher.
 */
export function resolveGrantedScopes(
  returned: string | null | undefined,
  requested: string[],
) {
  const parsed = parseScopeList(returned);
  return parsed.length > 0 ? parsed : [...requested];
}

export function generateState() {
  return randomBytes(24).toString("base64url");
}

/**
 * LinkedIn's token endpoint rejects the exchange with `invalid_client` (HTTP
 * 401, "Client authentication failed") whenever a `code_verifier` is sent, even
 * when the matching `code_challenge` was included in the authorization request
 * and the app credentials are valid. Verified against the live API:
 *
 *   code + code_verifier  -> 401 invalid_client
 *   code without verifier -> 200 access_token
 *
 * PKCE is therefore intentionally not used. CSRF protection comes from the
 * single-use `state` value stored in `oauth_states`.
 */
export const LINKEDIN_SUPPORTS_PKCE = false;

export function buildAuthorizationUrl(
  state: string,
  redirectUri: string = getLinkedInRedirectUri(),
  scopes: string = getLinkedInScopes(),
) {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  if (!clientId) {
    throw new LinkedInOAuthError("LINKEDIN_CLIENT_ID is not configured.", "not_configured");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: requireLinkedInRedirectUri(redirectUri),
    state,
    scope: scopes,
  });
  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

export type AuthorizationProbeResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "redirect_uri_mismatch"
        | "invalid_client"
        | "invalid_scope"
        | "not_configured"
        | "probe_unavailable";
      /** Human-readable explanation, safe to show in the UI. */
      detail: string;
      /** True when retrying cannot help until a human changes a setting. */
      blocking: boolean;
    };

/**
 * LinkedIn validates `redirect_uri` on its own page *before* showing consent.
 * When the URL is not registered on the app, the browser dead-ends on
 * "Bummer, something went wrong. The redirect_uri does not match the registered
 * value" and never returns to /accounts, so the failure is invisible to the
 * app and looks like "connect just doesn't work".
 *
 * Probing the authorization endpoint server-side turns that dead end into a
 * precise message naming the exact URL to register in the LinkedIn app.
 */
export async function probeAuthorizationRequest(options: {
  redirectUri?: string;
  /** Scope string to probe. Defaults to the configured LINKEDIN_SCOPES. */
  scopes?: string;
  timeoutMs?: number;
} = {}): Promise<AuthorizationProbeResult> {
  let authorizationUrl: string;
  try {
    authorizationUrl = buildAuthorizationUrl(
      generateState(),
      options.redirectUri ?? getLinkedInRedirectUri(),
      options.scopes ?? getLinkedInScopes(),
    );
  } catch (error) {
    return {
      ok: false,
      code: "not_configured",
      detail:
        error instanceof Error ? error.message : "LinkedIn OAuth is not configured.",
      blocking: true,
    };
  }

  let response: Response;
  try {
    response = await fetch(authorizationUrl, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch {
    // LinkedIn unreachable (offline, blocked network). Do not block connecting:
    // the browser may still reach LinkedIn even when the server cannot.
    return {
      ok: false,
      code: "probe_unavailable",
      detail: "Could not reach LinkedIn to pre-check the redirect URL.",
      blocking: false,
    };
  }

  // A redirect means LinkedIn accepted the request and is sending the member to
  // the login/consent screen.
  if (response.status >= 300 && response.status < 400) return { ok: true };

  const html = await response.text().catch(() => "");
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  if (/redirect_uri does not match the registered value/i.test(text)) {
    return {
      ok: false,
      code: "redirect_uri_mismatch",
      detail:
        "LinkedIn does not have this callback URL registered for the app, so it refuses the connection before the consent screen.",
      blocking: true,
    };
  }
  if (/client_id is invalid/i.test(text)) {
    return {
      ok: false,
      code: "invalid_client",
      detail:
        "LinkedIn says the configured LINKEDIN_CLIENT_ID is invalid. Copy the Client ID from the LinkedIn developer app.",
      blocking: true,
    };
  }
  if (/scope/i.test(text) && /(invalid|not (?:allowed|approved|authorized))/i.test(text)) {
    return {
      ok: false,
      code: "invalid_scope",
      detail:
        "LinkedIn rejected one or more requested permissions. Keep LINKEDIN_SCOPES to the products approved for the app.",
      blocking: true,
    };
  }

  return { ok: true };
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string = getLinkedInRedirectUri(),
) {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new LinkedInOAuthError(
      "LinkedIn OAuth credentials are not configured on the server.",
      "not_configured",
    );
  }

  // No `code_verifier` here: LinkedIn answers 401 invalid_client when one is
  // present. See LINKEDIN_SUPPORTS_PKCE above.
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: requireLinkedInRedirectUri(redirectUri),
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let providerCode = "";
    let providerDescription = "";
    try {
      const parsed = JSON.parse(text) as { error?: string; error_description?: string };
      providerCode = parsed.error ?? "";
      providerDescription = parsed.error_description ?? "";
    } catch {
      // Non-JSON error body; fall back to the raw text checks below.
    }
    // Log the provider's reason (never the secret) so server logs are actionable.
    // The client id and redirect URI are public and are the values that must
    // match between the authorization request and this exchange.
    console.error("LinkedIn token exchange failed", {
      status: response.status,
      error: providerCode || null,
      description: providerDescription || null,
      rawBody: providerCode ? null : text.slice(0, 300),
      clientId: clientId ? `${clientId.slice(0, 6)}…(${clientId.length} chars)` : null,
      redirectUri: requireLinkedInRedirectUri(redirectUri),
      codeLength: code.length,
      codePrefix: code.slice(0, 8),
    });

    if (providerCode === "invalid_client" || /client authentication failed/i.test(text)) {
      throw new LinkedInOAuthError(
        "LinkedIn rejected the app credentials: the Client Secret does not match the Client ID. Open the LinkedIn app → Auth tab, copy the Client ID and the Primary Client Secret from the same app (use the copy icon), update LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET, restart the app, then connect again.",
        "invalid_client",
      );
    }
    if (
      /authorization code not found/i.test(providerDescription) ||
      /authorization code not found/i.test(text)
    ) {
      throw new LinkedInOAuthError(
        "LinkedIn does not recognise this authorization code. It was already used, expired, or was issued for a different LinkedIn app. Click Connect LinkedIn again and complete the consent screen in one go without reloading or going back.",
        "authorization_code_not_found",
      );
    }
    if (response.status === 400 && /invalid_grant/i.test(text)) {
      throw new LinkedInOAuthError(
        "The LinkedIn authorization code expired or was already used. Try connecting again.",
        "invalid_grant",
      );
    }
    if (/invalid_scope/i.test(text)) {
      throw new LinkedInOAuthError(
        "LinkedIn rejected one or more requested permissions. Keep LINKEDIN_SCOPES to `openid profile email w_member_social` for personal publishing, and add `w_organization_social r_organization_admin` only after the Community Management API is approved for your app.",
        "invalid_scope",
      );
    }
    throw new LinkedInOAuthError(
      `LinkedIn rejected the authorization (HTTP ${response.status}${
        providerCode ? ` · ${providerCode}` : ""
      })${providerDescription ? `: ${providerDescription}` : ""}. Check the app credentials and redirect URL.`,
      "token_exchange_failed",
    );
  }

  const json = (await response.json()) as LinkedInTokenResponse;
  if (!json.access_token) {
    throw new LinkedInOAuthError(
      "LinkedIn did not return an access token. Try connecting again.",
      "empty_token",
    );
  }
  return json;
}

export async function fetchLinkedInProfile(accessToken: string): Promise<LinkedInProfile> {
  const response = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new LinkedInOAuthError(
      response.status === 401
        ? "LinkedIn rejected the new access token. Try connecting again."
        : "Could not load your LinkedIn profile. Check that the openid and profile scopes are approved.",
      "profile_fetch_failed",
    );
  }
  const json = (await response.json()) as {
    sub?: string;
    name?: string;
    picture?: string;
    email?: string;
  };
  if (!json.sub) {
    throw new LinkedInOAuthError(
      "LinkedIn returned a profile without a member id. Try connecting again.",
      "missing_member_id",
    );
  }
  return {
    sub: json.sub,
    name: json.name ?? null,
    picture: json.picture ?? null,
    email: json.email ?? null,
  };
}

type AclElement = {
  organization?: string | { id?: number | string; localizedName?: string; vanityName?: string };
  role?: string;
  state?: string;
};

function organizationIdFromAcl(element: AclElement): string | null {
  if (element.organization && typeof element.organization === "object") {
    return element.organization.id ? String(element.organization.id) : null;
  }
  if (typeof element.organization === "string") {
    return element.organization.replace(/^urn:li:organization:/, "") || null;
  }
  return null;
}

/**
 * Discover company pages the member can administer. Requires the Community
 * Management API (`r_organization_admin`, `w_organization_social`) to be
 * approved on the LinkedIn app. Missing approval is not an OAuth failure; the
 * account still connects for personal publishing.
 */
export async function fetchOrganizationAccess(
  accessToken: string,
  scopes: string[],
): Promise<{
  organizations: LinkedInOrganization[];
  warning: string | null;
  /**
   * True only when LinkedIn returned a complete ACL page. Callers must not
   * prune stored pages when this is false (a network/API failure would
   * otherwise look like "the member administers no pages").
   */
  complete: boolean;
}> {
  if (!hasOrganizationAdminScope(scopes)) {
    return {
      organizations: [],
      warning:
        "Company pages were not imported because the LinkedIn app has not been approved for organization admin access.",
      complete: false,
    };
  }

  const apiVersion = getLinkedInApiVersion();
  const params = new URLSearchParams({
    q: "roleAssignee",
    projection:
      "(elements*(organization~(id,localizedName,vanityName),role,state))",
    count: "100",
  });

  let response: Response;
  try {
    response = await fetch(`https://api.linkedin.com/v2/organizationAcls?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      cache: "no-store",
    });
  } catch {
    return {
      organizations: [],
      warning: "Company page discovery could not reach LinkedIn. You can retry from Accounts.",
      complete: false,
    };
  }

  if (!response.ok) {
    return {
      organizations: [],
      warning:
        response.status === 403
          ? "LinkedIn has not approved this app for Company Page API access, so pages could not be imported."
          : `LinkedIn returned HTTP ${response.status} while loading company pages.`,
      complete: false,
    };
  }

  const json = (await response.json()) as { elements?: AclElement[] };
  const hasOrgScope = hasOrganizationPublishScope(scopes);
  const canPublishRoles = new Set(["ADMINISTRATOR", "CONTENT_ADMIN"]);

  const organizations: LinkedInOrganization[] = [];
  for (const element of json.elements ?? []) {
    const id = organizationIdFromAcl(element);
    if (!id) continue;
    const nested = typeof element.organization === "object" ? element.organization : null;
    const state = element.state ?? "UNKNOWN";
    const role = element.role ?? null;
    let name = nested?.localizedName ?? "";
    let vanityName = nested?.vanityName ?? null;

    if (!name) {
      try {
        const detailResponse = await fetch(
          `https://api.linkedin.com/v2/organizations/${encodeURIComponent(id)}?projection=(id,localizedName,vanityName)`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "LinkedIn-Version": apiVersion,
              "X-Restli-Protocol-Version": "2.0.0",
            },
            cache: "no-store",
          },
        );
        if (detailResponse.ok) {
          const detail = (await detailResponse.json()) as {
            localizedName?: string;
            vanityName?: string;
          };
          name = detail.localizedName ?? "";
          vanityName = detail.vanityName ?? vanityName;
        }
      } catch {
        // Non-fatal; the page is still usable by id.
      }
    }

    organizations.push({
      id,
      name: name || `Company page ${id}`,
      vanityName,
      logoUrl: null,
      role,
      state,
      canPublish:
        state === "APPROVED" && hasOrgScope && role !== null && canPublishRoles.has(role),
    });
  }

  const warning =
    organizations.length === 0
      ? "No LinkedIn company pages were found for this member. You need a Super Admin or Content Admin role to publish as a page."
      : !hasOrgScope
        ? "Company pages were found, but w_organization_social is not granted. Reconnect after LinkedIn approves the permission."
        : null;

  return { organizations, warning, complete: true };
}
