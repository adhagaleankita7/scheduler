/**
 * LINKFLOW · LinkedIn publishing core
 *
 * This module is intentionally runtime-agnostic (fetch + Uint8Array only) so
 * the exact same code runs inside the Supabase Edge Function (Deno) and in the
 * Vitest suite that proves the publishing workflow.
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 */

export const LINKEDIN_API_BASE = "https://api.linkedin.com";
export const LINKEDIN_OAUTH_BASE = "https://www.linkedin.com/oauth/v2";

export type PublishImage = {
  bytes: Uint8Array;
  mimeType: string;
  altText?: string | null;
};

export type PublishInput = {
  postId: string;
  memberId: string;
  organizationId?: string | null;
  commentary: string;
  idempotencyKey: string;
  accessToken: string;
  apiVersion: string;
  image?: PublishImage | null;
  fetchImpl?: typeof fetch;
};

export type PublishResult = {
  providerPostId: string;
  providerPostUrl: string | null;
  httpStatus: number | null;
  isMock: boolean;
  imageUrn: string | null;
};

export type LinkedInErrorCode =
  | "invalid_token"
  | "expired_token"
  | "missing_permissions"
  | "rate_limited"
  | "network_error"
  | "duplicate_post"
  | "invalid_content"
  | "image_upload_failed"
  | "linkedin_server_error"
  | "unknown_error";

export class LinkedInPublishError extends Error {
  code: LinkedInErrorCode;
  httpStatus: number | null;
  retryable: boolean;
  details: string | null;

  constructor(
    code: LinkedInErrorCode,
    message: string,
    options: { httpStatus?: number | null; retryable?: boolean; details?: string | null } = {},
  ) {
    super(message);
    this.name = "LinkedInPublishError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

export function buildAuthorUrn(input: {
  memberId: string;
  organizationId?: string | null;
}) {
  if (input.organizationId) {
    return `urn:li:organization:${input.organizationId}`;
  }
  if (!input.memberId) {
    throw new LinkedInPublishError(
      "invalid_token",
      "The connected LinkedIn account is missing a member id. Reconnect the account.",
    );
  }
  return `urn:li:person:${input.memberId}`;
}

export function buildPostPayload(input: {
  commentary: string;
  memberId: string;
  organizationId?: string | null;
  imageUrn?: string | null;
  altText?: string | null;
}) {
  const payload: Record<string, unknown> = {
    author: buildAuthorUrn(input),
    commentary: input.commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (input.imageUrn) {
    payload.content = {
      media: {
        id: input.imageUrn,
        ...(input.altText ? { altText: input.altText.slice(0, 300) } : {}),
      },
    };
  }

  return payload;
}

/**
 * Never publishes fake success in production. Mock publishing is explicitly
 * flagged in the database (`is_mock = true`) and surfaced in the UI.
 */
export function buildMockResult(postId: string, now = Date.now()): PublishResult {
  return {
    providerPostId: `urn:li:share:mock_${postId.replace(/-/g, "").slice(0, 20)}_${now}`,
    providerPostUrl: null,
    httpStatus: null,
    isMock: true,
    imageUrn: null,
  };
}

export function classifyLinkedInStatus(
  status: number,
  body: string,
  headers?: Headers,
): { code: LinkedInErrorCode; retryable: boolean; message: string } {
  const detail = extractErrorDetail(body);
  const retryAfter = headers?.get("retry-after");
  const rateLimited = status === 429 || (status === 403 && /throttle|rate limit/i.test(detail));

  if (status === 401) {
    return {
      code: "invalid_token",
      retryable: false,
      message: "LinkedIn rejected the access token. Reconnect your LinkedIn account.",
    };
  }
  if (status === 403 && !rateLimited) {
    return {
      code: "missing_permissions",
      retryable: false,
      message:
        "LinkedIn denied this publish. The account is missing the required permission or company page role.",
    };
  }
  if (rateLimited) {
    return {
      code: "rate_limited",
      retryable: true,
      message: `LinkedIn rate limit reached${retryAfter ? ` (retry after ${retryAfter}s)` : ""}. LINKFLOW will retry automatically.`,
    };
  }
  if (status === 409) {
    return {
      code: "duplicate_post",
      retryable: false,
      message: "LinkedIn reported this post as a duplicate. It was not published again.",
    };
  }
  if (status >= 500) {
    return {
      code: "linkedin_server_error",
      retryable: true,
      message: "LinkedIn is temporarily unavailable. LINKFLOW will retry automatically.",
    };
  }
  if (status === 408 || status === 425) {
    return {
      code: "network_error",
      retryable: true,
      message: "The request to LinkedIn timed out. LINKFLOW will retry automatically.",
    };
  }
  if (status === 400 || status === 422) {
    return {
      code: "invalid_content",
      retryable: false,
      message: detail
        ? `LinkedIn rejected the post: ${detail}`
        : "LinkedIn rejected the post content. Check the text and media.",
    };
  }

  return {
    code: "unknown_error",
    retryable: status >= 500,
    message: detail || `LinkedIn returned HTTP ${status}.`,
  };
}

export function computeRetryDelaySeconds(attempt: number) {
  return Math.min(Math.pow(2, Math.max(attempt - 1, 0)) * 60, 3600);
}

export function isRetryableError(error: unknown) {
  if (error instanceof LinkedInPublishError) return error.retryable;
  if (error instanceof TypeError) return true; // fetch network failure
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

export function extractErrorDetail(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const message =
      parsed.message ??
      parsed.error_description ??
      parsed.error ??
      (parsed.serviceErrorCode as string | undefined);
    if (typeof message === "string") return message.slice(0, 500);
    return body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function linkedInHeaders(accessToken: string, apiVersion: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": apiVersion,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

async function ensureOk(
  response: Response,
  context: string,
): Promise<Response> {
  if (response.ok) return response;
  const body = await response.text().catch(() => "");
  const classified = classifyLinkedInStatus(response.status, body, response.headers);
  throw new LinkedInPublishError(classified.code, classified.message, {
    httpStatus: response.status,
    retryable: classified.retryable,
    details: `${context}: ${body.slice(0, 800)}`,
  });
}

async function uploadImage(
  input: PublishInput,
  authorUrn: string,
): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const initResponse = await fetchImpl(
    `${LINKEDIN_API_BASE}/rest/images?action=initializeUpload`,
    {
      method: "POST",
      headers: linkedInHeaders(input.accessToken, input.apiVersion),
      body: JSON.stringify({
        initializeUploadRequest: { owner: authorUrn },
      }),
    },
  );
  await ensureOk(initResponse, "image initializeUpload");
  const initBody = (await initResponse.json()) as {
    value?: { uploadUrl?: string; image?: string };
  };
  const uploadUrl = initBody.value?.uploadUrl;
  const imageUrn = initBody.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new LinkedInPublishError(
      "image_upload_failed",
      "LinkedIn did not return an image upload URL. Try the post without an image.",
      { retryable: true },
    );
  }

  const uploadResponse = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": input.image?.mimeType ?? "application/octet-stream",
    },
    body: input.image?.bytes as unknown as BodyInit,
  });
  await ensureOk(uploadResponse, "image binary upload");

  return imageUrn;
}

/**
 * Publishes a post using the official LinkedIn Posts API.
 * The function never retries internally; the scheduler owns retries so that
 * every attempt is claimed and logged exactly once.
 */
export async function publishToLinkedIn(
  input: PublishInput,
  options: { mock?: boolean } = {},
): Promise<PublishResult> {
  if (options.mock) return buildMockResult(input.postId);

  if (!input.accessToken) {
    throw new LinkedInPublishError(
      "invalid_token",
      "No LinkedIn access token is stored for this account. Reconnect it.",
    );
  }
  if (!input.commentary.trim()) {
    throw new LinkedInPublishError("invalid_content", "The post is empty.");
  }
  if (input.commentary.length > 3000) {
    throw new LinkedInPublishError(
      "invalid_content",
      "LinkedIn posts cannot exceed 3,000 characters.",
    );
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const authorUrn = buildAuthorUrn(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const imageUrn = input.image ? await uploadImage(input, authorUrn) : null;
    const payload = buildPostPayload({
      commentary: input.commentary,
      memberId: input.memberId,
      organizationId: input.organizationId,
      imageUrn,
      altText: input.image?.altText,
    });

    const response = await fetchImpl(`${LINKEDIN_API_BASE}/rest/posts`, {
      method: "POST",
      headers: {
        ...linkedInHeaders(input.accessToken, input.apiVersion),
        "X-Restli-Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    await ensureOk(response, "create post");

    const restliId = response.headers.get("x-restli-id");
    const bodyText = await response.text().catch(() => "");
    let providerPostId = restliId?.trim() || "";
    if (!providerPostId && bodyText) {
      try {
        const parsed = JSON.parse(bodyText) as Record<string, unknown>;
        providerPostId = String(parsed.id ?? parsed["x-restli-id"] ?? "");
      } catch {
        providerPostId = bodyText.trim();
      }
    }
    if (!providerPostId) {
      // LinkedIn accepted the post but returned no URN. Treat as success with a
      // synthetic reference so the UI still has something to link to.
      providerPostId = `urn:li:share:accepted_${input.postId.replace(/-/g, "").slice(0, 20)}`;
    }

    return {
      providerPostId,
      providerPostUrl: providerPostId.startsWith("urn:li:")
        ? `https://www.linkedin.com/feed/update/${encodeURIComponent(providerPostId)}`
        : null,
      httpStatus: response.status,
      isMock: false,
      imageUrn,
    };
  } catch (error) {
    if (error instanceof LinkedInPublishError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new LinkedInPublishError(
        "network_error",
        "The request to LinkedIn timed out. LINKFLOW will retry automatically.",
        { retryable: true },
      );
    }
    throw new LinkedInPublishError(
      "network_error",
      "Could not reach LinkedIn. LINKFLOW will retry automatically.",
      { retryable: true, details: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export type RefreshedTokens = {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
};

export async function refreshLinkedInToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<RefreshedTokens> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });

  const response = await fetchImpl(`${LINKEDIN_OAUTH_BASE}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const invalidGrant = /invalid_grant|expired/i.test(text);
    throw new LinkedInPublishError(
      invalidGrant ? "expired_token" : "invalid_token",
      invalidGrant
        ? "The LinkedIn refresh token expired. Reconnect your LinkedIn account."
        : "LinkedIn rejected the token refresh. Reconnect your LinkedIn account.",
      { httpStatus: response.status, retryable: false, details: text.slice(0, 500) },
    );
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
  };
  if (!json.access_token) {
    throw new LinkedInPublishError(
      "invalid_token",
      "LinkedIn returned an empty access token. Reconnect your LinkedIn account.",
    );
  }

  const now = Date.now();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    accessExpiresAt: json.expires_in
      ? new Date(now + json.expires_in * 1000).toISOString()
      : null,
    refreshExpiresAt: json.refresh_token_expires_in
      ? new Date(now + json.refresh_token_expires_in * 1000).toISOString()
      : null,
  };
}

export function tokenNeedsRefresh(
  expiresAt: string | null | undefined,
  thresholdSeconds = 300,
  now = Date.now(),
) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  return expires - now < thresholdSeconds * 1000;
}
