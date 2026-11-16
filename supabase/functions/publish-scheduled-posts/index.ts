// LINKFLOW · publish-scheduled-posts
// Supabase Edge Function (Deno). Invoked every minute by pg_cron → pg_net.
//
// Security:
//   * Requires the shared x-cron-secret header (stored in Supabase Vault).
//   * Uses the service role only inside this function; tokens stay server-side.
//   * Mock mode is opt-in and explicitly recorded as is_mock = true.
//
// Deploy: supabase functions deploy publish-scheduled-posts --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  LinkedInPublishError,
  isRetryableError,
  publishToLinkedIn,
  refreshLinkedInToken,
  tokenNeedsRefresh,
  type PublishResult,
} from "../_shared/linkedin.ts";

type PostRow = {
  id: string;
  user_id: string;
  social_account_id: string | null;
  social_page_id: string | null;
  target_type: "member" | "organization";
  content: string;
  attempt_count: number;
  idempotency_key: string;
};

type TokenRow = {
  user_id: string;
  provider_account_id: string;
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  status: string;
  scopes: string[] | null;
};

type PageRow = {
  id: string;
  provider_page_id: string;
  name: string;
  can_publish: boolean;
  role: string | null;
};

const workerId = `edge-${crypto.randomUUID()}`;
const JSON_HEADERS = { "Content-Type": "application/json" };

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function timingSafeEqual(a: string, b: string) {
  // Never treat two empty/blank values as a match. An unset service-role key
  // must fail closed, not authenticate an empty bearer token.
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function logAttempt(
  supabase: ReturnType<typeof createClient>,
  entry: {
    post: PostRow;
    status: "started" | "success" | "failure" | "retry_scheduled" | "skipped";
    message: string;
    httpStatus?: number | null;
    providerPostId?: string | null;
    errorCode?: string | null;
    isMock: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.from("publishing_logs").insert({
    post_id: entry.post.id,
    user_id: entry.post.user_id,
    attempt: entry.post.attempt_count,
    status: entry.status,
    provider: entry.isMock ? "mock" : "linkedin",
    http_status: entry.httpStatus ?? null,
    provider_post_id: entry.providerPostId ?? null,
    error_code: entry.errorCode ?? null,
    message: entry.message,
    is_mock: entry.isMock,
    metadata: entry.metadata ?? null,
  });
  if (error) console.error("Failed to write publishing log", error.message);
}

async function loadImage(
  supabase: ReturnType<typeof createClient>,
  postId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; altText: string | null } | null> {
  const { data: media, error } = await supabase
    .from("post_media")
    .select("storage_path, mime_type, alt_text")
    .eq("post_id", postId)
    .maybeSingle();

  if (error) throw new Error(`Could not load post media: ${error.message}`);
  if (!media) return null;

  const { data: blob, error: downloadError } = await supabase.storage
    .from("post-media")
    .download(media.storage_path);
  if (downloadError || !blob) {
    throw new LinkedInPublishError(
      "image_upload_failed",
      "The post image could not be loaded from storage.",
      { retryable: true, details: downloadError?.message ?? null },
    );
  }

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: media.mime_type,
    altText: media.alt_text,
  };
}

async function publishOne(
  supabase: ReturnType<typeof createClient>,
  post: PostRow,
  mock: boolean,
): Promise<{ outcome: "published" | "retry" | "failed" | "skipped"; message: string }> {
  if (!post.social_account_id) {
    await logAttempt(supabase, {
      post,
      status: "failure",
      message: "No LinkedIn account is connected to this post.",
      errorCode: "account_missing",
      isMock: false,
    });
    await supabase.rpc("mark_post_failed", {
      p_post_id: post.id,
      p_error_code: "account_missing",
      p_error_message: "No LinkedIn account is connected to this post. Reconnect LinkedIn and reschedule it.",
      p_http_status: null,
      p_retryable: false,
    });
    return { outcome: "failed", message: "account_missing" };
  }

  const { data: tokenRows, error: tokenError } = await supabase.rpc("get_social_tokens", {
    p_account_id: post.social_account_id,
  });
  const tokens = (tokenRows?.[0] ?? null) as TokenRow | null;

  // Belt-and-braces ownership check: the worker uses the service role, so it
  // must never spend one tenant's token on another tenant's post.
  if (tokens && tokens.user_id !== post.user_id) {
    const message = "This post's target does not belong to its owner.";
    await logAttempt(supabase, {
      post,
      status: "failure",
      message,
      errorCode: "target_mismatch",
      isMock: false,
    });
    await supabase.rpc("mark_post_failed", {
      p_post_id: post.id,
      p_error_code: "target_mismatch",
      p_error_message: message,
      p_http_status: null,
      p_retryable: false,
    });
    return { outcome: "failed", message: "target_mismatch" };
  }

  if (tokenError || !tokens || !tokens.access_token) {
    const message = tokenError
      ? `Could not read stored LinkedIn credentials: ${tokenError.message}`
      : "LinkedIn credentials are missing. Reconnect the account.";
    await supabase
      .from("social_accounts")
      .update({ status: "needs_reconnect", last_error: message })
      .eq("id", post.social_account_id);
    await logAttempt(supabase, {
      post,
      status: "failure",
      message,
      errorCode: "account_disconnected",
      isMock: false,
    });
    await supabase.rpc("mark_post_failed", {
      p_post_id: post.id,
      p_error_code: "account_disconnected",
      p_error_message: message,
      p_http_status: null,
      p_retryable: false,
    });
    return { outcome: "failed", message: "account_disconnected" };
  }

  if (tokens.status !== "connected") {
    const message = "The LinkedIn account needs to be reconnected before publishing.";
    await logAttempt(supabase, {
      post,
      status: "failure",
      message,
      errorCode: "account_reconnect_required",
      isMock: false,
    });
    await supabase.rpc("mark_post_failed", {
      p_post_id: post.id,
      p_error_code: "account_reconnect_required",
      p_error_message: message,
      p_http_status: null,
      p_retryable: false,
    });
    return { outcome: "failed", message: "account_reconnect_required" };
  }

  // Verify organization publishing rights against the stored LinkedIn state.
  let organizationId: string | null = null;
  if (post.target_type === "organization") {
    if (!post.social_page_id) {
      const message = "This post targets a company page but no page is attached.";
      await logAttempt(supabase, { post, status: "failure", message, errorCode: "page_missing", isMock: false });
      await supabase.rpc("mark_post_failed", {
        p_post_id: post.id,
        p_error_code: "page_missing",
        p_error_message: message,
        p_http_status: null,
        p_retryable: false,
      });
      return { outcome: "failed", message: "page_missing" };
    }

    const { data: page } = await supabase
      .from("social_pages")
      .select("id, provider_page_id, name, can_publish, role")
      .eq("id", post.social_page_id)
      .eq("user_id", post.user_id)
      .maybeSingle<PageRow>();

    const hasOrgScope = (tokens.scopes ?? []).includes("w_organization_social");
    if (!page || !page.can_publish || !hasOrgScope) {
      const message = !page
        ? "The selected company page is no longer available."
        : !hasOrgScope
          ? "The connected LinkedIn account is missing the w_organization_social permission. Reconnect with company page access."
          : "Your LinkedIn member no longer has an admin role on this company page.";
      await logAttempt(supabase, {
        post,
        status: "failure",
        message,
        errorCode: "missing_permissions",
        isMock: false,
      });
      await supabase.rpc("mark_post_failed", {
        p_post_id: post.id,
        p_error_code: "missing_permissions",
        p_error_message: message,
        p_http_status: 403,
        p_retryable: false,
      });
      return { outcome: "failed", message: "missing_permissions" };
    }
    organizationId = page.provider_page_id;
  } else if (tokens.scopes && !tokens.scopes.includes("w_member_social")) {
    const message =
      "The connected LinkedIn account is missing the w_member_social permission. Reconnect it to publish.";
    await logAttempt(supabase, {
      post,
      status: "failure",
      message,
      errorCode: "missing_permissions",
      isMock: false,
    });
    await supabase.rpc("mark_post_failed", {
      p_post_id: post.id,
      p_error_code: "missing_permissions",
      p_error_message: message,
      p_http_status: 403,
      p_retryable: false,
    });
    return { outcome: "failed", message: "missing_permissions" };
  }

  await logAttempt(supabase, {
    post,
    status: "started",
    message: mock
      ? "Mock publishing started (simulated — nothing is sent to LinkedIn)."
      : "Publishing to LinkedIn.",
    isMock: mock,
  });

  let accessToken = tokens.access_token;
  let refreshToken = tokens.refresh_token;
  let accessExpiresAt = tokens.access_token_expires_at;
  let refreshExpiresAt = tokens.refresh_token_expires_at;

  if (!mock && tokenNeedsRefresh(accessExpiresAt)) {
    const clientId = env("LINKEDIN_CLIENT_ID");
    const clientSecret = env("LINKEDIN_CLIENT_SECRET");
    if (!refreshToken || !clientId || !clientSecret) {
      const message =
        "The LinkedIn access token expired and cannot be refreshed. Reconnect your LinkedIn account.";
      await supabase
        .from("social_accounts")
        .update({ status: "needs_reconnect", last_error: message })
        .eq("id", post.social_account_id);
      await logAttempt(supabase, {
        post,
        status: "failure",
        message,
        errorCode: "token_expired",
        isMock: false,
      });
      await supabase.rpc("mark_post_failed", {
        p_post_id: post.id,
        p_error_code: "token_expired",
        p_error_message: message,
        p_http_status: 401,
        p_retryable: false,
      });
      return { outcome: "failed", message: "token_expired" };
    }

    try {
      const refreshed = await refreshLinkedInToken({
        refreshToken,
        clientId,
        clientSecret,
      });
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken ?? refreshToken;
      accessExpiresAt = refreshed.accessExpiresAt;
      refreshExpiresAt = refreshed.refreshExpiresAt ?? refreshExpiresAt;

      await supabase.rpc("store_social_tokens", {
        p_account_id: post.social_account_id,
        p_access_token: accessToken,
        p_refresh_token: refreshToken,
        p_access_expires_at: accessExpiresAt,
        p_refresh_expires_at: refreshExpiresAt,
        p_scopes: tokens.scopes,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "LinkedIn token refresh failed.";
      await supabase
        .from("social_accounts")
        .update({ status: "needs_reconnect", last_error: message })
        .eq("id", post.social_account_id);
      await logAttempt(supabase, {
        post,
        status: "failure",
        message,
        errorCode: "token_refresh_failed",
        isMock: false,
      });
      await supabase.rpc("mark_post_failed", {
        p_post_id: post.id,
        p_error_code: "token_refresh_failed",
        p_error_message: message,
        p_http_status: null,
        p_retryable: false,
      });
      return { outcome: "failed", message: "token_refresh_failed" };
    }
  }

  let result: PublishResult;
  try {
    const image = await loadImage(supabase, post.id);
    result = await publishToLinkedIn(
      {
        postId: post.id,
        memberId: tokens.provider_account_id,
        organizationId,
        commentary: post.content,
        idempotencyKey: post.idempotency_key,
        accessToken,
        apiVersion: env("LINKEDIN_API_VERSION") || "202610",
        image,
      },
      { mock },
    );
  } catch (error) {
    const publishError =
      error instanceof LinkedInPublishError
        ? error
        : new LinkedInPublishError(
            "unknown_error",
            error instanceof Error ? error.message : "Publishing failed.",
            { retryable: isRetryableError(error) },
          );

    if (publishError.code === "invalid_token" || publishError.code === "expired_token") {
      await supabase
        .from("social_accounts")
        .update({ status: "needs_reconnect", last_error: publishError.message })
        .eq("id", post.social_account_id);
    }

    const { data: nextStatus, error: failError } = await supabase.rpc("mark_post_failed", {
      p_post_id: post.id,
      p_error_code: publishError.code,
      p_error_message: publishError.message,
      p_http_status: publishError.httpStatus,
      p_retryable: publishError.retryable,
    });
    if (failError) console.error("mark_post_failed failed", failError.message);

    const willRetry = nextStatus === "scheduled";
    await logAttempt(supabase, {
      post,
      status: willRetry ? "retry_scheduled" : "failure",
      message: publishError.message,
      errorCode: publishError.code,
      httpStatus: publishError.httpStatus,
      isMock: mock,
      metadata: publishError.details ? { details: publishError.details } : undefined,
    });

    return {
      outcome: willRetry ? "retry" : "failed",
      message: publishError.code,
    };
  }

  const { data: marked, error: markError } = await supabase.rpc("mark_post_published", {
    p_post_id: post.id,
    p_provider_post_id: result.providerPostId,
    p_provider_post_url: result.providerPostUrl,
    p_is_mock: result.isMock,
    p_http_status: result.httpStatus,
  });

  if (markError || marked !== true) {
    // LinkedIn accepted the post but the local state was already changed.
    // This is the rare "at-least-once" window documented in the README.
    await logAttempt(supabase, {
      post,
      status: "skipped",
      message:
        "LinkedIn accepted the post but LINKFLOW could not transition it (it may already be published). Manual review required.",
      errorCode: "state_transition_conflict",
      providerPostId: result.providerPostId,
      isMock: result.isMock,
      metadata: { markError: markError?.message ?? null },
    });
    return { outcome: "skipped", message: "state_transition_conflict" };
  }

  await logAttempt(supabase, {
    post,
    status: "success",
    message: result.isMock
      ? "Mock publish completed. No content was sent to LinkedIn."
      : "Published to LinkedIn.",
    providerPostId: result.providerPostId,
    httpStatus: result.httpStatus,
    isMock: result.isMock,
    metadata: { providerPostUrl: result.providerPostUrl, imageUrn: result.imageUrn },
  });

  return { outcome: "published", message: result.providerPostId };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...JSON_HEADERS,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, x-cron-secret, authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = env("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const authorized =
    (Boolean(cronSecret) && timingSafeEqual(providedSecret, cronSecret)) ||
    (Boolean(serviceKey) && timingSafeEqual(bearer, serviceKey));

  if (!authorized) {
    return json({ error: "Unauthorized" }, 401);
  }

  const mock = env("LINKEDIN_MOCK_MODE") === "true";
  if (mock && env("LINKFLOW_ENV") === "production") {
    return json(
      {
        error:
          "LINKEDIN_MOCK_MODE is enabled in a production environment. Refusing to run so mock results are never mistaken for real publishing.",
      },
      500,
    );
  }

  if (!env("SUPABASE_URL") || !serviceKey) {
    return json({ error: "Supabase function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." }, 500);
  }

  const supabase = createClient(env("SUPABASE_URL"), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = Date.now();
  const summary = {
    worker: workerId,
    mock,
    claimed: 0,
    published: 0,
    retry: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  const { data: claimed, error: claimError } = await supabase.rpc("claim_due_posts", {
    p_worker: workerId,
    p_limit: 20,
  });

  if (claimError) {
    console.error("claim_due_posts failed", claimError.message);
    return json({ ...summary, error: claimError.message }, 500);
  }

  const posts = (claimed ?? []) as PostRow[];
  summary.claimed = posts.length;

  for (const post of posts) {
    try {
      const result = await publishOne(supabase, post, mock);
      if (result.outcome === "published") summary.published++;
      else if (result.outcome === "retry") summary.retry++;
      else if (result.outcome === "skipped") summary.skipped++;
      else summary.failed++;
    } catch (error) {
      // Last-resort safety: never leave a claimed post stuck in processing.
      const message = error instanceof Error ? error.message : "Unexpected worker error";
      summary.failed++;
      summary.errors.push(`${post.id}: ${message}`);
      console.error("Unexpected publish error", post.id, message);
      await supabase.rpc("mark_post_failed", {
        p_post_id: post.id,
        p_error_code: "worker_error",
        p_error_message: "An unexpected publishing error occurred. LINKFLOW will retry automatically.",
        p_http_status: null,
        p_retryable: true,
      }).then(({ error: rpcError }) => {
        if (rpcError) console.error("cleanup mark_post_failed failed", rpcError.message);
      });
    }
  }

  return json({ ...summary, durationMs: Date.now() - startedAt });
});
