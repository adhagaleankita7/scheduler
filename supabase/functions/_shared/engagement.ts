/**
 * LINKFLOW · engagement readers
 *
 * Fetches like/comment/share counts for posts that are already live. Kept
 * runtime-agnostic (fetch only, injectable implementation) so the Supabase Edge
 * Function and the Vitest suite share exactly the same code.
 *
 * Providers rate-limit these endpoints, so the worker refreshes each post at
 * most every ~15 minutes and stores the result on public.posts.
 */

import { LINKEDIN_API_BASE } from "./linkedin.ts";
import { fetchPageAccessToken, graphBaseUrl } from "./facebook.ts";

export type EngagementCounts = {
  likes: number;
  comments: number;
  shares: number;
};

/** The provider has no stats endpoint for this post (permissions/type). */
export class EngagementUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngagementUnavailableError";
  }
}

/** A real request failure worth recording on the post. */
export class EngagementError extends Error {
  httpStatus: number | null;

  constructor(message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "EngagementError";
    this.httpStatus = httpStatus;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

function toCount(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

export function parseLinkedInEngagement(payload: unknown): EngagementCounts {
  const root = (payload ?? {}) as {
    likesSummary?: { totalLikes?: unknown };
    commentsSummary?: { totalFirstLevelComments?: unknown; totalComments?: unknown };
  };
  return {
    likes: toCount(root.likesSummary?.totalLikes),
    comments: toCount(
      root.commentsSummary?.totalFirstLevelComments ?? root.commentsSummary?.totalComments,
    ),
    // Social Actions does not expose reposts; keep it at zero.
    shares: 0,
  };
}

export function parseFacebookEngagement(payload: unknown): EngagementCounts {
  const root = (payload ?? {}) as {
    reactions?: { summary?: { total_count?: unknown } };
    comments?: { summary?: { total_count?: unknown } };
    shares?: { count?: unknown };
  };
  return {
    likes: toCount(root.reactions?.summary?.total_count),
    comments: toCount(root.comments?.summary?.total_count),
    shares: toCount(root.shares?.count),
  };
}

/**
 * LinkedIn's Posts API returns a URN such as `urn:li:share:123`. Older
 * responses only include the numeric restli id, which we promote to a share
 * URN. Mock/synthetic ids are not fetchable.
 */
export function linkedInActivityUrn(providerPostId: string | null | undefined): string | null {
  const trimmed = (providerPostId ?? "").trim();
  if (!trimmed) return null;
  if (/^urn:li:(?:share|ugcPost|activity):\d+$/i.test(trimmed)) return trimmed;
  if (/^urn:/i.test(trimmed)) return null; // mock/synthetic URN
  if (/^\d+$/.test(trimmed)) return `urn:li:share:${trimmed}`;
  return null;
}

export async function fetchLinkedInEngagement(input: {
  accessToken: string;
  apiVersion: string;
  providerPostId: string | null;
  fetchImpl?: typeof fetch;
}): Promise<EngagementCounts> {
  const urn = linkedInActivityUrn(input.providerPostId);
  if (!urn) {
    throw new EngagementUnavailableError("This post has no readable LinkedIn URN.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(
      `${LINKEDIN_API_BASE}/v2/socialActions/${encodeURIComponent(urn)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "LinkedIn-Version": input.apiVersion,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        signal: controller.signal,
      },
    );

    const text = await response.text().catch(() => "");

    if (response.status === 403 || response.status === 404) {
      throw new EngagementUnavailableError(
        "LinkedIn does not expose stats for this post type or permission set.",
      );
    }
    if (!response.ok) {
      throw new EngagementError(
        `LinkedIn stats request failed (HTTP ${response.status}).`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new EngagementError("LinkedIn returned unreadable stats.", response.status);
    }
    return parseLinkedInEngagement(payload);
  } catch (error) {
    if (error instanceof EngagementUnavailableError || error instanceof EngagementError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new EngagementError("LinkedIn stats request timed out.", null);
    }
    throw new EngagementError(
      error instanceof Error ? error.message : "Could not read LinkedIn stats.",
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchFacebookEngagement(input: {
  /** Long-lived member token stored in Vault. */
  accessToken: string;
  /** Provider Page id (not the LINKFLOW row id). */
  pageId: string;
  graphVersion: string;
  providerPostId: string | null;
  fetchImpl?: typeof fetch;
}): Promise<EngagementCounts> {
  if (!input.providerPostId) {
    throw new EngagementUnavailableError("This post has no Facebook post id.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const pageToken = await fetchPageAccessToken({
      accessToken: input.accessToken,
      pageId: input.pageId,
      graphVersion: input.graphVersion,
      signal: controller.signal,
      fetchImpl,
    });

    const params = new URLSearchParams({
      fields: "reactions.summary(total_count),comments.summary(total_count),shares",
      access_token: pageToken,
    });

    const response = await fetchImpl(
      `${graphBaseUrl(input.graphVersion)}/${encodeURIComponent(input.providerPostId)}?${params.toString()}`,
      { method: "GET", signal: controller.signal },
    );
    const text = await response.text().catch(() => "");

    if (response.status === 403 || response.status === 404) {
      throw new EngagementUnavailableError(
        "Facebook does not expose stats for this post or permission set.",
      );
    }
    if (!response.ok) {
      // Reactions and comments on a Page post need pages_read_user_content
      // (or Page Public Content Access). With only pages_read_engagement Meta
      // answers code 10 — the stats are optional, so do not surface it as a
      // publishing failure on the post.
      if (
        response.status === 400 &&
        /pages_read_user_content|Page Public Content Access/i.test(text)
      ) {
        throw new EngagementUnavailableError(
          "Facebook needs pages_read_user_content to read post reactions and comments.",
        );
      }
      throw new EngagementError(
        `Facebook stats request failed (HTTP ${response.status}).`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new EngagementError("Facebook returned unreadable stats.", response.status);
    }
    return parseFacebookEngagement(payload);
  } catch (error) {
    if (error instanceof EngagementUnavailableError || error instanceof EngagementError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new EngagementError("Facebook stats request timed out.", null);
    }
    throw new EngagementError(
      error instanceof Error ? error.message : "Could not read Facebook stats.",
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}
