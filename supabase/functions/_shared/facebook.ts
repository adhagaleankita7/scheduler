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
 *       https://developers.facebook.com/docs/graph-api/reference/page/feed
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
  | "app_access_blocked"
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

/**
 * A Page photo upload can be several megabytes, so it gets a larger budget than
 * a normal Graph request. Feed/token calls stay at 30s so a hung request cannot
 * hold the worker slot (or the scheduler's minute tick) open.
 */
const PHOTO_UPLOAD_TIMEOUT_MS = 60_000;
const GRAPH_REQUEST_TIMEOUT_MS = 30_000;
const PHOTO_CLEANUP_TIMEOUT_MS = 5_000;

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
  // Subcode 5258005 ("API access blocked") is returned by Meta when the app
  // itself is restricted — it blocks every Graph call, even with a valid app
  // token. Retrying or reconnecting cannot fix it, and it is not a missing
  // page role, so keep it separate from missing_permissions.
  if (error?.error_subcode === 5258005 || /api access blocked/i.test(detail)) {
    return {
      code: "app_access_blocked",
      retryable: false,
      message:
        "Meta has blocked API access for this Facebook app (error 5258005). Open the Meta App Dashboard, clear the app restriction (App Review, Business Verification or Data Use Checkup), then reconnect Facebook.",
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

/**
 * Upload a photo to the Page as an *unpublished* photo and return its id.
 *
 * Posting straight to `/{page-id}/photos` with `published=true` creates a photo
 * story: Facebook files it under the Page's Photos tab as an image rather than
 * a regular post in the feed. Uploading first and then attaching the photo to a
 * `/feed` post (see publishFeedPost) produces a normal Page post that happens
 * to include a photo — which is what a scheduler post should look like.
 */
async function uploadPagePhoto(
  input: FacebookPublishInput,
  pageToken: string,
): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.set("published", "false");
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
  await ensureOk(response, "upload photo", text);

  let json: { id?: string } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new FacebookPublishError(
      "image_upload_failed",
      "Facebook returned an unreadable photo response. LINKFLOW will retry automatically.",
      { retryable: true, details: text.slice(0, 300) },
    );
  }

  if (!json.id) {
    throw new FacebookPublishError(
      "image_upload_failed",
      "Facebook did not return an id for the uploaded photo. LINKFLOW will retry automatically.",
      { retryable: true },
    );
  }

  return json.id;
}

/**
 * Create a normal Page feed post. When `photoId` is supplied the photo is
 * attached with `attached_media[0]`, so the story is a regular post (feed)
 * instead of a photo-tab upload.
 */
async function publishFeedPost(
  input: FacebookPublishInput,
  pageToken: string,
  photoId: string | null,
): Promise<{ id: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    message: input.message,
    access_token: pageToken,
  });
  if (photoId) {
    body.set("attached_media[0]", JSON.stringify({ media_fbid: photoId }));
  }

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
 * Build a canonical, reliable permalink. A feed response id looks like
 * `{page-id}_{post-id}`; `/posts/{post-id}` opens the story directly, whereas a
 * bare photo id (the old behaviour when Facebook omitted `post_id`) sometimes
 * led to a link that never resolved.
 */
export function facebookPostUrl(providerPostId: string): string {
  const separator = providerPostId.indexOf("_");
  if (separator > 0 && separator < providerPostId.length - 1) {
    const pageId = providerPostId.slice(0, separator);
    const storyId = providerPostId.slice(separator + 1);
    return `https://www.facebook.com/${encodeURIComponent(pageId)}/posts/${encodeURIComponent(storyId)}`;
  }
  return `https://www.facebook.com/${encodeURIComponent(providerPostId)}`;
}

/**
 * Run one Graph call under its own timeout while still honouring an outer abort
 * signal. Each step of a publish gets a fresh budget, so a slow image upload no
 * longer eats into the time available for the feed call.
 */
async function withTimeout<T>(
  ms: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Facebook request timed out.", "AbortError")),
    ms,
  );
  const forwardAbort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) forwardAbort();
    else parent.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
    parent?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Delete an unpublished photo after its feed post failed. Best-effort: a stray
 * unpublished photo is harmless, so a cleanup failure must never mask the
 * original publish error or turn a retryable failure into a permanent one.
 */
async function deletePagePhoto(
  input: FacebookPublishInput,
  pageToken: string,
  photoId: string,
): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PHOTO_CLEANUP_TIMEOUT_MS);

  try {
    const response = await fetchImpl(
      `${graphBaseUrl(input.graphVersion)}/${encodeURIComponent(photoId)}?` +
        new URLSearchParams({ access_token: pageToken }).toString(),
      { method: "DELETE", signal: controller.signal },
    );
    if (!response.ok) {
      console.warn(`Could not clean up unpublished Facebook photo ${photoId}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn(
      `Could not clean up unpublished Facebook photo ${photoId}:`,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Post a comment on a Page post as the Page itself. Used for the optional
 * "first comment" feature; the caller treats a failure as non-fatal because the
 * post is already live.
 */
export async function commentOnFacebookPost(input: {
  pageId: string;
  postId: string;
  message: string;
  accessToken: string;
  graphVersion: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  if (!input.message.trim()) return null;

  return withTimeout(GRAPH_REQUEST_TIMEOUT_MS, input.signal, async (signal) => {
    const fetchImpl = input.fetchImpl ?? fetch;
    const pageToken = await fetchPageAccessToken({
      accessToken: input.accessToken,
      pageId: input.pageId,
      graphVersion: input.graphVersion,
      signal,
      fetchImpl,
    });

    const body = new URLSearchParams({
      message: input.message,
      access_token: pageToken,
    });
    const response = await fetchImpl(
      `${graphBaseUrl(input.graphVersion)}/${encodeURIComponent(input.postId)}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      },
    );
    const text = await response.text().catch(() => "");
    await ensureOk(response, "post first comment", text);

    try {
      const json = JSON.parse(text) as { id?: string };
      return json.id ?? null;
    } catch {
      return null;
    }
  });
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

  try {
    const pageToken = await withTimeout(GRAPH_REQUEST_TIMEOUT_MS, input.signal, (signal) =>
      fetchPageAccessToken({ ...input, signal }),
    );

    // Two-step image publish: upload the photo unpublished, then create a
    // normal feed post that attaches it. A single call to /photos would create
    // a "photo" story instead of a regular Page post.
    const photoId = input.image
      ? await withTimeout(PHOTO_UPLOAD_TIMEOUT_MS, input.signal, (signal) =>
          uploadPagePhoto({ ...input, signal }, pageToken),
        )
      : null;

    let result: { id: string | null };
    try {
      result = await withTimeout(GRAPH_REQUEST_TIMEOUT_MS, input.signal, (signal) =>
        publishFeedPost({ ...input, signal }, pageToken, photoId),
      );
    } catch (error) {
      // The photo was uploaded but never became a post. Remove it so retries do
      // not slowly fill the Page's unpublished photo library.
      if (photoId) await deletePagePhoto(input, pageToken, photoId);
      throw error;
    }

    if (!result.id) {
      throw new FacebookPublishError(
        "facebook_server_error",
        "Facebook accepted the post but returned no post id. LINKFLOW will retry automatically.",
        { retryable: true },
      );
    }
    return {
      providerPostId: result.id,
      providerPostUrl: facebookPostUrl(result.id),
      httpStatus: 200,
      isMock: false,
      imageUrn: photoId,
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
