import {
  getAppUrl,
  getFacebookGraphVersion,
  getFacebookLoginConfigId,
  getFacebookScopes,
} from "@/lib/env";

/**
 * Facebook OAuth (Facebook Login) for publishing to Pages.
 *
 * Meta's Graph API can only publish automated posts to Facebook **Pages**.
 * Posting to personal profiles was removed from the API, so LINKFLOW connects
 * the member's Facebook account and exposes their manageable Pages as targets.
 *
 * Docs: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 */

export const FACEBOOK_CALLBACK_PATH = "/api/facebook/callback";

export class FacebookOAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string = "oauth_error",
  ) {
    super(message);
    this.name = "FacebookOAuthError";
  }
}

export type FacebookTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

export type FacebookProfile = {
  id: string;
  name: string | null;
  email: string | null;
  picture: string | null;
};

export type FacebookPage = {
  id: string;
  name: string;
  username: string | null;
  link: string | null;
  category: string | null;
  picture: string | null;
  tasks: string[];
  canPublish: boolean;
};

function graphUrl(path: string) {
  const version = getFacebookGraphVersion().replace(/^\/+|\/+$/g, "");
  return `https://graph.facebook.com/${version}/${path.replace(/^\/+/, "")}`;
}

export function getFacebookRedirectUri(origin?: string) {
  const override = process.env.FACEBOOK_REDIRECT_URI?.trim();
  if (override) return override.replace(/\/+$/, "");
  const base = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    origin?.trim() ||
    getAppUrl()
  ).replace(/\/+$/, "");
  return `${base}${FACEBOOK_CALLBACK_PATH}`;
}

export function buildFacebookAuthorizationUrl(
  state: string,
  redirectUri: string = getFacebookRedirectUri(),
  scopes: string = getFacebookScopes(),
) {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  if (!appId) {
    throw new FacebookOAuthError("FACEBOOK_APP_ID is not configured.", "not_configured");
  }

  // Meta's current app-creation flow installs "Facebook Login for Business",
  // which authorises through a saved configuration instead of raw scopes.
  // Classic apps fall back to FACEBOOK_SCOPES.
  const configId = getFacebookLoginConfigId();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    // Re-ask for every permission even when Facebook remembers an earlier
    // grant. Without this, a connection that was once approved without
    // pages_manage_posts silently keeps the old, unusable permission set and
    // every Page publish fails with "(#200) Permissions error".
    auth_type: "rerequest",
    ...(configId
      ? { config_id: configId, override_default_response_type: "true" }
      : { scope: scopes }),
  });
  return `https://www.facebook.com/${getFacebookGraphVersion()}/dialog/oauth?${params.toString()}`;
}

function appCredentials() {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new FacebookOAuthError(
      "Facebook OAuth credentials are not configured on the server.",
      "not_configured",
    );
  }
  return { appId, appSecret };
}

async function readError(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; type?: string; code?: number };
      error_message?: string;
    };
    return {
      message: parsed.error?.message ?? parsed.error_message ?? "",
      code: parsed.error?.code ?? null,
      raw: text,
    };
  } catch {
    return { message: text.slice(0, 300), code: null, raw: text };
  }
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string = getFacebookRedirectUri(),
) {
  const { appId, appSecret } = appCredentials();
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(graphUrl("oauth/access_token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await readError(response);
    console.error("Facebook token exchange failed", {
      status: response.status,
      message: detail.message.slice(0, 300),
    });
    throw new FacebookOAuthError(
      detail.message
        ? `Facebook rejected the authorization: ${detail.message}`
        : `Facebook rejected the authorization (HTTP ${response.status}). Check the App ID, App Secret and redirect URL.`,
      "token_exchange_failed",
    );
  }

  const json = (await response.json()) as FacebookTokenResponse;
  if (!json.access_token) {
    throw new FacebookOAuthError(
      "Facebook did not return an access token. Try connecting again.",
      "empty_token",
    );
  }
  return json;
}

/**
 * Swap the short-lived token (valid ~1–2 hours) for a long-lived token
 * (valid ~60 days). Page posts need a token that survives until the queue runs.
 */
export async function exchangeForLongLivedToken(shortToken: string) {
  const { appId, appSecret } = appCredentials();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });

  const response = await fetch(graphUrl(`oauth/access_token?${params.toString()}`), {
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new FacebookOAuthError(
      detail.message
        ? `Facebook could not extend the access token: ${detail.message}`
        : "Facebook could not extend the access token. Try connecting again.",
      "long_lived_token_failed",
    );
  }

  const json = (await response.json()) as FacebookTokenResponse;
  if (!json.access_token) {
    throw new FacebookOAuthError(
      "Facebook returned an empty long-lived token.",
      "empty_token",
    );
  }
  return json;
}

export async function fetchFacebookProfile(accessToken: string): Promise<FacebookProfile> {
  const params = new URLSearchParams({
    fields: "id,name,email,picture.type(large)",
    access_token: accessToken,
  });

  const response = await fetch(graphUrl(`me?${params.toString()}`), { cache: "no-store" });
  if (!response.ok) {
    const detail = await readError(response);
    throw new FacebookOAuthError(
      response.status === 401 || detail.code === 190
        ? "Facebook rejected the new access token. Try connecting again."
        : "Could not load your Facebook profile. Check that the app is allowed to request public_profile.",
      "profile_fetch_failed",
    );
  }

  const json = (await response.json()) as {
    id?: string;
    name?: string;
    email?: string;
    picture?: { data?: { url?: string } };
  };
  if (!json.id) {
    throw new FacebookOAuthError(
      "Facebook returned a profile without a user id. Try connecting again.",
      "missing_user_id",
    );
  }

  return {
    id: json.id,
    name: json.name ?? null,
    email: json.email ?? null,
    picture: json.picture?.data?.url ?? null,
  };
}

/**
 * Reads the scopes Facebook actually granted. The authorization request only
 * says what we asked for; a user (or Meta's own permission gating) can drop
 * page permissions, so the callback must store the real list instead.
 */
export async function fetchGrantedScopes(accessToken: string): Promise<string[]> {
  const { appId, appSecret } = appCredentials();
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: `${appId}|${appSecret}`,
  });

  const response = await fetch(graphUrl(`debug_token?${params.toString()}`), {
    cache: "no-store",
  });
  if (!response.ok) return [];

  const json = (await response.json()) as {
    data?: {
      scopes?: string[];
      granular_scopes?: Array<{ scope?: string }>;
    };
  };

  const scopes = new Set<string>(json.data?.scopes ?? []);
  for (const entry of json.data?.granular_scopes ?? []) {
    if (entry.scope) scopes.add(entry.scope);
  }
  return [...scopes];
}

function usernameFromLink(link: string | null | undefined) {
  if (!link) return null;
  try {
    const url = new URL(link);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Tasks Meta reports for a Page. CREATE_CONTENT is required to publish.
 * https://developers.facebook.com/docs/graph-api/reference/page/tasks
 */
export function canPublishToPage(tasks: readonly string[] | null | undefined) {
  if (!tasks?.length) return false;
  return tasks.some((task) => {
    const normalized = task.toUpperCase();
    return normalized === "CREATE_CONTENT" || normalized === "MANAGE";
  });
}

/**
 * Discover Pages the member can publish to. Requires pages_show_list and
 * pages_read_engagement. Follows Meta's cursor pagination for accounts with
 * many Pages.
 */
export async function fetchFacebookPages(accessToken: string): Promise<{
  pages: FacebookPage[];
  warning: string | null;
  complete: boolean;
}> {
  const pages: FacebookPage[] = [];
  let nextUrl: string | null = graphUrl(
    `me/accounts?fields=id,name,link,category,tasks,picture{url}&limit=100&access_token=${encodeURIComponent(accessToken)}`,
  );
  let requests = 0;

  while (nextUrl && requests < 10) {
    requests += 1;
    let response: Response;
    try {
      response = await fetch(nextUrl, { cache: "no-store" });
    } catch {
      return {
        pages,
        warning: "Facebook Page discovery could not reach Meta. You can retry from Accounts.",
        complete: false,
      };
    }

    if (!response.ok) {
      const detail = await readError(response);
      return {
        pages,
        warning:
          response.status === 403 || detail.code === 200
            ? "Facebook has not granted pages_show_list / pages_read_engagement, so Pages could not be imported."
            : `Facebook returned HTTP ${response.status} while loading Pages.`,
        complete: false,
      };
    }

    const json = (await response.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        link?: string;
        category?: string;
        tasks?: string[];
        picture?: { data?: { url?: string } };
      }>;
      paging?: { next?: string };
    };

    for (const item of json.data ?? []) {
      if (!item.id || !item.name) continue;
      const tasks = item.tasks ?? [];
      pages.push({
        id: item.id,
        name: item.name,
        username: usernameFromLink(item.link),
        link: item.link ?? null,
        category: item.category ?? null,
        picture: item.picture?.data?.url ?? null,
        tasks,
        canPublish: canPublishToPage(tasks),
      });
    }

    nextUrl = json.paging?.next ?? null;
  }

  return {
    pages,
    warning:
      pages.length === 0
        ? "No Facebook Pages were found. You need a Page role that allows creating content (for example an admin or editor)."
        : null,
    complete: true,
  };
}
