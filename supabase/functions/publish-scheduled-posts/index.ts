// LINKFLOW · publish-scheduled-posts
// Supabase Edge Function (Deno). Invoked every minute by pg_cron → pg_net.
//
// Security:
//   * Requires the shared x-cron-secret header (stored in Supabase Vault).
//   * Uses the service role only inside this function; tokens stay server-side.
//   * Mock mode is opt-in and explicitly recorded as is_mock = true.
//
// Supported providers:
//   * linkedin — personal member or company page (Posts API)
//   * facebook — Facebook Page only (Graph API)
//
// Deploy: supabase functions deploy publish-scheduled-posts --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  LinkedInPublishError,
  commentOnLinkedInPost,
  extractDuplicateUrn,
  isRetryableError,
  publishToLinkedIn,
  refreshLinkedInToken,
  tokenNeedsRefresh,
  type PublishResult,
} from "../_shared/linkedin.ts";
import {
  FacebookPublishError,
  commentOnFacebookPost,
  isRetryableFacebookError,
  publishToFacebookPage,
  refreshFacebookToken,
} from "../_shared/facebook.ts";
import {
  EngagementUnavailableError,
  fetchFacebookEngagement,
  fetchLinkedInEngagement,
} from "../_shared/engagement.ts";
import { isMockProviderAccountId } from "../_shared/mock.ts";

type Provider = "linkedin" | "facebook";

type PostRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  social_account_id: string | null;
  social_page_id: string | null;
  target_type: "member" | "organization";
  content: string;
  first_comment: string | null;
  attempt_count: number;
  idempotency_key: string;
};

type AccountRow = {
  provider: Provider;
  provider_account_id: string | null;
  user_id: string;
  workspace_id: string;
};

type TokenRow = {
  user_id: string;
  provider: Provider;
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

type PublishFailure = {
  code: string;
  message: string;
  httpStatus: number | null;
  retryable: boolean;
  details: string | null;
};

const workerId = `edge-${crypto.randomUUID()}`;
const JSON_HEADERS = { "Content-Type": "application/json" };
const FACEBOOK_REFRESH_WINDOW_SECONDS = 3 * 24 * 60 * 60;

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

function platformName(provider: Provider) {
  return provider === "facebook" ? "Facebook" : "LinkedIn";
}

function buildMockResult(post: PostRow, provider: Provider): PublishResult {
  return {
    providerPostId: `urn:${provider}:mock_${post.id.replace(/-/g, "").slice(0, 20)}_${Date.now()}`,
    providerPostUrl: null,
    httpStatus: null,
    isMock: true,
    imageUrn: null,
  };
}

async function logAttempt(
  supabase: ReturnType<typeof createClient>,
  entry: {
    post: PostRow;
    status: "started" | "success" | "failure" | "retry_scheduled" | "skipped";
    message: string;
    provider?: Provider;
    httpStatus?: number | null;
    providerPostId?: string | null;
    errorCode?: string | null;
    isMock: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.from("publishing_logs").insert({
    workspace_id: entry.post.workspace_id,
    post_id: entry.post.id,
    user_id: entry.post.user_id,
    attempt: entry.post.attempt_count,
    status: entry.status,
    provider: entry.isMock ? "mock" : entry.provider ?? "linkedin",
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
  mockModes: { linkedin: boolean; facebook: boolean },
): Promise<{ outcome: "published" | "retry" | "failed" | "skipped"; message: string }> {
  if (!post.social_account_id) {
    const message = "No social account is connected to this post.";
    await logAttempt(supabase, {
      post,
      status: "failure",
      message,
      errorCode: "account_missing",
      isMock: false,
    });
    await supabase.rpc("mark_post_failed", {
      p_post_id: post.id,
      p_error_code: "account_missing",
      p_error_message: `${message} Reconnect the account and reschedule it.`,
      p_http_status: null,
      p_retryable: false,
    });
    return { outcome: "failed", message: "account_missing" };
  }

  const { data: accountRow } = await supabase
    .from("social_accounts")
    .select("provider, provider_account_id, user_id, workspace_id")
    .eq("id", post.social_account_id)
    .maybeSingle<AccountRow>();
  const provider: Provider = accountRow?.provider === "facebook" ? "facebook" : "linkedin";
  const platform = platformName(provider);
  // Mock mode is per provider: a workspace can simulate Facebook while
  // LinkedIn publishing is live (or the other way round). Accounts created by
  // a mock connect route are always simulated, whatever this worker's env says:
  // their token can never resolve against the real API, and a real failure
  // would only hide the fact that nothing was ever connected.
  const mock = mockModes[provider] || isMockProviderAccountId(accountRow?.provider_account_id);

  const { data: tokenRows, error: tokenError } = await supabase.rpc("get_social_tokens", {
    p_account_id: post.social_account_id,
  });
  const tokens = (tokenRows?.[0] ?? null) as TokenRow | null;

  // Belt-and-braces ownership check: the worker uses the service role, so it
  // must never spend one workspace's token on another workspace's post. A
  // collaborator can publish through an account the workspace owner connected,
  // so compare against the account's owner and workspace, not the post author.
  if (
    !accountRow ||
    accountRow.workspace_id !== post.workspace_id ||
    (tokens && tokens.user_id !== accountRow.user_id)
  ) {
    const message = "This post's target does not belong to its workspace.";
    await logAttempt(supabase, {
      post,
      status: "failure",
      message,
      provider,
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
      ? `Could not read stored ${platform} credentials: ${tokenError.message}`
      : `${platform} credentials are missing. Reconnect the account.`;
    await supabase
      .from("social_accounts")
      .update({ status: "needs_reconnect", last_error: message })
      .eq("id", post.social_account_id);
    await logAttempt(supabase, {
      post,
      status: "failure",
      message,
      provider,
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
    const message = `The ${platform} account needs to be reconnected before publishing.`;
    await logAttempt(supabase, {
      post,
      status: "failure",
      message,
      provider,
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

  // -------------------------------------------------------------------------
  // Provider-specific target verification
  // -------------------------------------------------------------------------
  let organizationId: string | null = null;
  let facebookPageId: string | null = null;

  if (provider === "facebook") {
    if (!post.social_page_id) {
      const message = "This post targets a Facebook Page but no Page is attached.";
      await logAttempt(supabase, {
        post,
        status: "failure",
        message,
        provider,
        errorCode: "page_missing",
        isMock: false,
      });
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
      .eq("workspace_id", post.workspace_id)
      .eq("social_account_id", post.social_account_id)
      .eq("provider", "facebook")
      .maybeSingle<PageRow>();

    if (!page || !page.can_publish) {
      const message = !page
        ? "The selected Facebook Page is no longer available."
        : "Your Facebook user no longer has a Page role that can create content. Ask a Page admin for an Editor or Admin role, then reconnect.";
      await logAttempt(supabase, {
        post,
        status: "failure",
        message,
        provider,
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
    facebookPageId = page.provider_page_id;
  } else if (post.target_type === "organization") {
    // Verify organization publishing rights against the stored LinkedIn state.
    if (!post.social_page_id) {
      const message = "This post targets a company page but no page is attached.";
      await logAttempt(supabase, { post, status: "failure", message, provider, errorCode: "page_missing", isMock: false });
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
      .eq("workspace_id", post.workspace_id)
      .eq("social_account_id", post.social_account_id)
      .eq("provider", "linkedin")
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
        provider,
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
      provider,
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
      ? `Mock publishing started (simulated — nothing is sent to ${platform}).`
      : `Publishing to ${platform}.`,
    provider,
    isMock: mock,
  });

  let accessToken = tokens.access_token;
  let refreshToken = tokens.refresh_token;
  let accessExpiresAt = tokens.access_token_expires_at;
  let refreshExpiresAt = tokens.refresh_token_expires_at;

  // -------------------------------------------------------------------------
  // Token refresh (provider-specific)
  // -------------------------------------------------------------------------
  const needsRefresh =
    provider === "facebook"
      ? tokenNeedsRefresh(accessExpiresAt, FACEBOOK_REFRESH_WINDOW_SECONDS)
      : tokenNeedsRefresh(accessExpiresAt);

  if (!mock && needsRefresh) {
    try {
      if (provider === "facebook") {
        const appId = env("FACEBOOK_APP_ID");
        const appSecret = env("FACEBOOK_APP_SECRET");
        const graphVersion = env("FACEBOOK_GRAPH_VERSION") || "v23.0";
        if (!appId || !appSecret) {
          throw new Error(
            "The Facebook access token is expiring and FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are not configured on the worker. Reconnect the account.",
          );
        }

        const refreshed = await refreshFacebookToken({
          accessToken,
          appId,
          appSecret,
          graphVersion,
        });
        accessToken = refreshed.accessToken;
        accessExpiresAt = refreshed.expiresIn
          ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
          : null;

        await supabase.rpc("store_social_tokens", {
          p_account_id: post.social_account_id,
          p_access_token: accessToken,
          p_refresh_token: null,
          p_access_expires_at: accessExpiresAt,
          p_refresh_expires_at: null,
          p_scopes: tokens.scopes,
        });
      } else {
        const clientId = env("LINKEDIN_CLIENT_ID");
        const clientSecret = env("LINKEDIN_CLIENT_SECRET");
        if (!refreshToken || !clientId || !clientSecret) {
          throw new Error(
            "The LinkedIn access token expired and cannot be refreshed. Reconnect your LinkedIn account.",
          );
        }

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
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${platform} token refresh failed.`;
      await supabase
        .from("social_accounts")
        .update({ status: "needs_reconnect", last_error: message })
        .eq("id", post.social_account_id);
      await logAttempt(supabase, {
        post,
        status: "failure",
        message,
        provider,
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

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------
  let result: PublishResult;
  try {
    if (mock) {
      result = buildMockResult(post, provider);
    } else if (provider === "facebook") {
      const image = await loadImage(supabase, post.id);
      result = await publishToFacebookPage({
        postId: post.id,
        pageId: facebookPageId!,
        message: post.content,
        accessToken,
        graphVersion: env("FACEBOOK_GRAPH_VERSION") || "v23.0",
        image,
      });
    } else {
      const image = await loadImage(supabase, post.id);
      result = await publishToLinkedIn({
        postId: post.id,
        memberId: tokens.provider_account_id,
        organizationId,
        commentary: post.content,
        idempotencyKey: post.idempotency_key,
        accessToken,
        apiVersion: env("LINKEDIN_API_VERSION") || "202610",
        image,
      });
    }
  } catch (error) {
    const publishError: PublishFailure =
      error instanceof LinkedInPublishError || error instanceof FacebookPublishError
        ? {
            code: error.code,
            message: error.message,
            httpStatus: error.httpStatus,
            retryable: error.retryable,
            details: error.details,
          }
        : {
            code: "unknown_error",
            message: error instanceof Error ? error.message : "Publishing failed.",
            httpStatus: null,
            retryable: isRetryableError(error) || isRetryableFacebookError(error),
            details: null,
          };

    if (
      publishError.code === "invalid_token" ||
      publishError.code === "expired_token" ||
      publishError.code === "app_access_blocked"
    ) {
      await supabase
        .from("social_accounts")
        .update({ status: "needs_reconnect", last_error: publishError.message })
        .eq("id", post.social_account_id);
    }

    // LinkedIn rejects identical commentary with 400/409 and tells us which
    // share already exists. That share is live, so link it instead of leaving
    // the post failed forever (and never retry a guaranteed duplicate).
    const duplicateUrn =
      provider === "linkedin" && /duplicate/i.test(publishError.message)
        ? extractDuplicateUrn(publishError.message)
        : null;
    if (duplicateUrn) {
      const providerPostUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(duplicateUrn)}`;
      const { data: linked, error: linkError } = await supabase.rpc("mark_post_published", {
        p_post_id: post.id,
        p_provider_post_id: duplicateUrn,
        p_provider_post_url: providerPostUrl,
        p_is_mock: false,
        p_http_status: publishError.httpStatus,
      });
      if (!linkError && linked === true) {
        await logAttempt(supabase, {
          post,
          status: "success",
          message:
            "LinkedIn already had this exact post. LINKFLOW linked the existing share instead of publishing a duplicate.",
          provider,
          providerPostId: duplicateUrn,
          httpStatus: publishError.httpStatus,
          isMock: false,
          metadata: { duplicate: true, existingUrn: duplicateUrn },
        });
        return { outcome: "published", message: duplicateUrn };
      }
      if (linkError) {
        console.error("Could not link duplicate LinkedIn post", linkError.message);
      }
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
      provider,
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
    // The provider accepted the post but the local state was already changed.
    // This is the rare "at-least-once" window documented in the README.
    await logAttempt(supabase, {
      post,
      status: "skipped",
      message: `${platform} accepted the post but LINKFLOW could not transition it (it may already be published). Manual review required.`,
      provider,
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
      ? `Mock publish completed. No content was sent to ${platform}.`
      : `Published to ${platform}.`,
    provider,
    providerPostId: result.providerPostId,
    httpStatus: result.httpStatus,
    isMock: result.isMock,
    metadata: { providerPostUrl: result.providerPostUrl, imageUrn: result.imageUrn },
  });

  // The optional first comment is best-effort: the post is already live, so a
  // comment failure must never flip the post to failed or trigger a re-publish.
  if (!result.isMock && post.first_comment?.trim()) {
    try {
      if (provider === "facebook") {
        await commentOnFacebookPost({
          pageId: facebookPageId!,
          postId: result.providerPostId,
          message: post.first_comment.trim(),
          accessToken,
          graphVersion: env("FACEBOOK_GRAPH_VERSION") || "v23.0",
        });
      } else {
        await commentOnLinkedInPost({
          providerPostId: result.providerPostId,
          memberId: tokens.provider_account_id,
          organizationId,
          message: post.first_comment.trim(),
          accessToken,
          apiVersion: env("LINKEDIN_API_VERSION") || "202610",
        });
      }
      await logAttempt(supabase, {
        post,
        status: "success",
        message: "First comment posted.",
        provider,
        providerPostId: result.providerPostId,
        httpStatus: 200,
        isMock: false,
        metadata: { firstComment: true },
      });
    } catch (error) {
      await logAttempt(supabase, {
        post,
        status: "skipped",
        message: `Post published, but the first comment could not be added: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        provider,
        providerPostId: result.providerPostId,
        errorCode: "first_comment_failed",
        isMock: false,
      });
    }
  }

  return { outcome: "published", message: result.providerPostId };
}

type EngagementSummary = {
  engagementSynced: number;
  engagementFailed: number;
  errors: string[];
};

type EngagementRow = {
  id: string;
  user_id: string;
  social_account_id: string | null;
  social_page_id: string | null;
  provider_post_id: string | null;
};

/**
 * Refresh like/comment counts for recently published posts. Runs at the end of
 * every worker tick; each post is refreshed about once every 15 minutes so the
 * provider APIs are never hammered. Only the last 30 days are refreshed: older
 * posts are unlikely to change and would otherwise consume the whole provider
 * rate-limit budget forever. Failures are recorded on the post and never block
 * publishing.
 */
async function syncEngagement(
  supabase: ReturnType<typeof createClient>,
  summary: EngagementSummary,
) {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const publishedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("posts")
    .select("id, user_id, social_account_id, social_page_id, provider_post_id")
    .eq("status", "published")
    .eq("is_mock", false)
    .not("provider_post_id", "is", null)
    .gte("published_at", publishedCutoff)
    .or(`engagement_synced_at.is.null,engagement_synced_at.lt.${cutoff}`)
    .order("engagement_synced_at", { ascending: true, nullsFirst: true })
    .limit(10);

  if (error) {
    console.error("Engagement query failed", error.message);
    summary.errors.push(`engagement query: ${error.message}`);
    return;
  }

  for (const row of (data ?? []) as EngagementRow[]) {
    try {
      if (!row.social_account_id) continue;

      const { data: tokenRows } = await supabase.rpc("get_social_tokens", {
        p_account_id: row.social_account_id,
      });
      const tokens = (tokenRows?.[0] ?? null) as TokenRow | null;
      if (!tokens?.access_token) continue;

      const { data: account } = await supabase
        .from("social_accounts")
        .select("provider")
        .eq("id", row.social_account_id)
        .maybeSingle<{ provider: Provider }>();
      const provider: Provider = account?.provider === "facebook" ? "facebook" : "linkedin";

      let counts;
      if (provider === "facebook") {
        if (!row.social_page_id) continue;
        const { data: page } = await supabase
          .from("social_pages")
          .select("provider_page_id")
          .eq("id", row.social_page_id)
          .maybeSingle<{ provider_page_id: string }>();
        if (!page?.provider_page_id) continue;

        counts = await fetchFacebookEngagement({
          accessToken: tokens.access_token,
          pageId: page.provider_page_id,
          graphVersion: env("FACEBOOK_GRAPH_VERSION") || "v23.0",
          providerPostId: row.provider_post_id,
        });
      } else {
        counts = await fetchLinkedInEngagement({
          accessToken: tokens.access_token,
          apiVersion: env("LINKEDIN_API_VERSION") || "202610",
          providerPostId: row.provider_post_id,
        });
      }

      await supabase
        .from("posts")
        .update({
          like_count: counts.likes,
          comment_count: counts.comments,
          share_count: counts.shares,
          engagement_synced_at: new Date().toISOString(),
          engagement_error: null,
        })
        .eq("id", row.id);

      summary.engagementSynced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Engagement sync failed.";
      const unavailable = error instanceof EngagementUnavailableError;

      // "Unavailable" means the provider has no stats for this post type. Move
      // the timestamp forward so we do not ask again every minute, but keep the
      // UI clean instead of showing a permanent error.
      await supabase
        .from("posts")
        .update({
          engagement_synced_at: new Date().toISOString(),
          engagement_error: unavailable ? null : message.slice(0, 300),
        })
        .eq("id", row.id);

      summary.engagementFailed += 1;
      if (!unavailable) summary.errors.push(`engagement ${row.id}: ${message}`);
    }
  }
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

  const mockModes = {
    linkedin: env("LINKEDIN_MOCK_MODE") === "true",
    facebook: env("FACEBOOK_MOCK_MODE") === "true",
  };
  if ((mockModes.linkedin || mockModes.facebook) && env("LINKFLOW_ENV") === "production") {
    return json(
      {
        error:
          "Mock publishing is enabled in a production environment. Set LINKEDIN_MOCK_MODE=false and FACEBOOK_MOCK_MODE=false. Refusing to run so mock results are never mistaken for real publishing.",
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
    mock: mockModes,
    claimed: 0,
    published: 0,
    retry: 0,
    failed: 0,
    skipped: 0,
    engagementSynced: 0,
    engagementFailed: 0,
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
      const result = await publishOne(supabase, post, mockModes);
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

  await syncEngagement(supabase, summary);

  return json({ ...summary, durationMs: Date.now() - startedAt });
});
