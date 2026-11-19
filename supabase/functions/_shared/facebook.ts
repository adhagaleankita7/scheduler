/**
 * LINKFLOW · Facebook Pages publishing core
 *
 * Runtime-agnostic (fetch + Uint8Array + web FormData) so the same module runs
 * inside the Supabase Edge Function (Deno) and in Vitest.
 *
 * Meta only allows API publishing to Facebook *Pages*. A Page access token is
 * derived from the connected member's long-lived user token at publish time,
 * which keeps tokens fresh without storing per-Page secrets.
 *
 * Docs: https://developers.facebook.com/docs/pages-api/posts
 *       https://developers.facebook.com/docs/graph-api/reference/page/photos
 */

export type FacebookPublishImage = {
  bytes: Uint8Array;
  mimeType: string;
  altText?: string | null;
};

export type FacebookPublishInput = {
  postId: string;
  pageId: string;
  message: string;
  /** Long-lived member token stored in Vault. Never a Page token. */
  accessToken: string;
  graphVersion: string;
  image?: FacebookPublishImage | null;
  /** Optional abort signal, supplied by publishToFacebookPage's timeout. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type FacebookPublishResult = {
  providerPostId: string;
  providerPostUrl: string | null;
  httpStatus: number | null;
  isMock: boolean;
  imageUrn: string | null;
};

export type FacebookErrorCode =
  | "invalid_token"
  | "expired_token"
  | "missing_permissions"
  | "rate_limited"
  | "network_error"
  | "invalid_content"
  | "image_upload_failed"
  | "facebook_server_error"
  | "unknown_error";

export class FacebookPublishError extends Error {
  code: FacebookErrorCode;
  httpStatus: number | null;
  retryable: boolean;
  details: string | null;

  constructor(
    code: FacebookErrorCode,
    message: string,
    options: { httpStatus?: number | null; retryable?: boolean; details?: string | null } = {},
  ) {
    super(message);
    this.name = "FacebookPublishError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

export const FACEBOOK_MESSAGE_LIMIT = 63_206;

export function graphBaseUrl(graphVersion: string) {
  const version = (graphVersion || "v23.0").replace(/^\/+|\/+$/g, "");
  return `https://graph.facebook.com/${version}`;
}

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
  };
};

function parseGraphError(body: string): GraphErrorBody["error"] | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as GraphErrorBody;
    return parsed.error ?? null;
  } catch {
    return null;
  }
}

export function extractFacebookErrorDetail(body: string): string {
  const error = parseGraphError(body);
  if (error?.message) return error.message.slice(0, 500);
  return body.slice(0, 300);
}

export function classifyFacebookStatus(
  status: number,
  body: string,
): { code: FacebookErrorCode; retryable: boolean; message: string } {
  const error = parseGraphError(body);
  const providerCode = error?.code ?? null;
  const detail = extractFacebookErrorDetail(body);
  const transient = error?.is_transient === true;

  if (status === 401 || providerCode === 190) {
    return {
      code: "invalid_token",
      retryable: false,
      message:
        "Facebook rejected the access token. Reconnect your Facebook account to continue publishing.",
    };
  }
  if (providerCode === 4 || providerCode === 17 || providerCode === 32 || providerCode === 613) {
    return {
      code: "rate_limited",
      retryable: true,
      message: "Facebook rate limit reached. LINKFLOW will retry automatically.",
    };
  }
  if (providerCode === 1 || providerCode === 2 || status >= 500 || transient) {
    return {
      code: "facebook_server_error",
      retryable: true,
      message: "Facebook is temporarily unavailable. LINKFLOW will retry automatically.",
    };
  }
  if (
    status === 403 ||
    (providerCode !== null && providerCode >= 200 && providerCode <= 299)
  ) {
    return {
      code: "missing_permissions",
      retryable: false,
      message:
        "Facebook denied this publish (#200 Permissions error). Reconnect Facebook, grant pages_manage_posts, and make sure your user is an Admin or Editor of the Page. If you use a Facebook Login for Business configuration, include pages_manage_posts in that configuration.",
    };
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      retryable: true,
      message: "Facebook rate limit reached. LINKFLOW will retry automatically.",
    };
  }
  if (status === 400 || providerCode === 100) {
    return {
      code: "invalid_content",
      retryable: false,
      message: detail
        ? `Facebook rejected the post: ${detail}`
        : "Facebook rejected the post content. Check the text and image.",
    };
  }

  return {
    code: "unknown_error",
    retryable: status >= 500,
    message: detail || `Facebook returned HTTP ${status}.`,
  };
}

async function ensureOk(response: Response, context: string, body?: string) {
  if (response.ok) return;
  const text = body ?? (await response.text().catch(() => ""));
  const classified = classifyFacebookStatus(response.status, text);
  throw new FacebookPublishError(classified.code, classified.message, {
    httpStatus: response.status,
    retryable: classified.retryable,
    details: `${context}: ${text.slice(0, 800)}`,
  });
}

/**
 * Resolve a Page access token from the stored long-lived member token.
 * /me/accounts requires pages_show_list, which the connect flow requests.
 */
export async function fetchPageAccessToken(
  input: Pick<FacebookPublishInput, "accessToken" | "pageId" | "graphVersion" | "signal" | "fetchImpl">,
): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let nextUrl: string | null =
    `${graphBaseUrl(input.graphVersion)}/me/accounts?` +
    new URLSearchParams({
      fields: "id,name,access_token",
      limit: "100",
      access_token: input.accessToken,
    }).toString();

  let requests = 0;
  while (nextUrl && requests < 10) {
    requests += 1;
    const response = await fetchImpl(nextUrl, { method: "GET", signal: input.signal });
    const text = await response.text().catch(() => "");
    await ensureOk(response, "list pages", text);

    let json: {
      data?: Array<{ id?: string; access_token?: string }>;
      paging?: { next?: string };
    };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new FacebookPublishError(
        "facebook_server_error",
        "Facebook returned an unreadable page list. LINKFLOW will retry automatically.",
        { retryable: true, details: text.slice(0, 300) },
      );
    }

    const match = (json.data ?? []).find((page) => page.id === input.pageId);
    if (match?.access_token) return match.access_token;

    nextUrl = json.paging?.next ?? null;
  }

  throw new FacebookPublishError(
    "missing_permissions",
    "LINKFLOW could not get a Page access token. Reconnect Facebook and make sure you are an admin or editor of the Page.",
  );
}

async function publishPhoto(
  input: FacebookPublishInput,
  pageToken: string,
): Promise<{ id: string | null; postId: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.set("message", input.message);
  form.set("published", "true");
  form.set("access_token", pageToken);
  form.set(
    "source",
    new Blob([input.image!.bytes as unknown as BlobPart], {
      type: input.image!.mimeType || "application/octet-stream",
    }),
    `post-image.${input.image!.mimeType === "image/png" ? "png" : input.image!.mimeType === "image/webp" ? "webp" : "jpg"}`,
  );

  const response = await fetchImpl(
    `${graphBaseUrl(input.graphVersion)}/${encodeURIComponent(input.pageId)}/photos`,
    { method: "POST", body: form, signal: input.signal },
  );
  const text = await response.text().catch(() => "");
  await ensureOk(response, "publish photo", text);

  try {
    const json = JSON.parse(text) as { id?: string; post_id?: string };
    return { id: json.id ?? null, postId: json.post_id ?? null };
  } catch {
    return { id: null, postId: null };
  }
}

async function publishTextPost(
  input: FacebookPublishInput,
  pageToken: string,
): Promise<{ id: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    message: input.message,
    access_token: pageToken,
  });

  const response = await fetchImpl(
    `${graphBaseUrl(input.graphVersion)}/${encodeURIComponent(input.pageId)}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: input.signal,
    },
  );
  const text = await response.text().catch(() => "");
  await ensureOk(response, "publish post", text);

  try {
    const json = JSON.parse(text) as { id?: string };
    return { id: json.id ?? null };
  } catch {
    return { id: null };
  }
}

/**
 * Publishes a post to a Facebook Page. Never retries internally; the scheduler
 * owns retries so every attempt is claimed and logged exactly once.
 *
 * Note: Graph API has no idempotency-key header. The database's unique
 * (social_account_id, provider_post_id) index plus the single-claim state
 * machine still prevent double publishing.
 */
export async function publishToFacebookPage(
  input: FacebookPublishInput,
): Promise<FacebookPublishResult> {
  if (!input.accessToken) {
    throw new FacebookPublishError(
      "invalid_token",
      "No Facebook access token is stored for this account. Reconnect it.",
    );
  }
  if (!input.pageId) {
    throw new FacebookPublishError(
      "invalid_content",
      "Choose a Facebook Page. Personal profiles cannot be posted to by the API.",
    );
  }
  if (!input.message.trim()) {
    throw new FacebookPublishError("invalid_content", "The post is empty.");
  }
  if (input.message.length > FACEBOOK_MESSAGE_LIMIT) {
    throw new FacebookPublishError(
      "invalid_content",
      `Facebook posts cannot exceed ${FACEBOOK_MESSAGE_LIMIT.toLocaleString()} characters.`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  // Every Graph request shares one 30s budget, so a hung upload cannot hold the
  // worker slot (or the scheduler's minute tick) open.
  const request: FacebookPublishInput = { ...input, signal: controller.signal };

  try {
    const pageToken = await fetchPageAccessToken(request);

    if (request.image) {
      const result = await publishPhoto(request, pageToken);
      const providerPostId = result.postId ?? result.id;
      if (!providerPostId) {
        throw new FacebookPublishError(
          "facebook_server_error",
          "Facebook accepted the photo but returned no post id. LINKFLOW will retry automatically.",
          { retryable: true },
        );
      }
      return {
        providerPostId,
        providerPostUrl: `https://www.facebook.com/${encodeURIComponent(providerPostId)}`,
        httpStatus: 200,
        isMock: false,
        imageUrn: result.id,
      };
    }

    const result = await publishTextPost(request, pageToken);
    if (!result.id) {
      throw new FacebookPublishError(
        "facebook_server_error",
        "Facebook accepted the post but returned no post id. LINKFLOW will retry automatically.",
        { retryable: true },
      );
    }
    return {
      providerPostId: result.id,
      providerPostUrl: `https://www.facebook.com/${encodeURIComponent(result.id)}`,
      httpStatus: 200,
      isMock: false,
      imageUrn: null,
    };
  } catch (error) {
    if (error instanceof FacebookPublishError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new FacebookPublishError(
        "network_error",
        "The request to Facebook timed out. LINKFLOW will retry automatically.",
        { retryable: true },
      );
    }
    throw new FacebookPublishError(
      "network_error",
      "Could not reach Facebook. LINKFLOW will retry automatically.",
      { retryable: true, details: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extend the stored long-lived member token before it expires. Facebook exposes
 * no refresh token; `fb_exchange_token` returns a fresh long-lived token.
 */
export async function refreshFacebookToken(input: {
  accessToken: string;
  appId: string;
  appSecret: string;
  graphVersion: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; expiresIn: number | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: input.appId,
    client_secret: input.appSecret,
    fb_exchange_token: input.accessToken,
  });

  const response = await fetchImpl(
    `${graphBaseUrl(input.graphVersion)}/oauth/access_token?${params.toString()}`,
    { method: "GET" },
  );
  const text = await response.text().catch(() => "");

  if (!response.ok) {
    const detail = extractFacebookErrorDetail(text);
    throw new FacebookPublishError(
      "invalid_token",
      detail
        ? `Facebook could not extend the access token: ${detail}`
        : "Facebook could not extend the access token. Reconnect your Facebook account.",
      { httpStatus: response.status, retryable: false, details: text.slice(0, 500) },
    );
  }

  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new FacebookPublishError(
      "invalid_token",
      "Facebook returned an unreadable token response. Reconnect your Facebook account.",
      { retryable: false },
    );
  }

  if (!json.access_token) {
    throw new FacebookPublishError(
      "invalid_token",
      "Facebook returned an empty access token. Reconnect your Facebook account.",
    );
  }

  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? null,
  };
}

export function isRetryableFacebookError(error: unknown) {
  if (error instanceof FacebookPublishError) return error.retryable;
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}
