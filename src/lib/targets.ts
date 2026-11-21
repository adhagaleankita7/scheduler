/**
 * Publishing-target helpers shared by the server data layer, the demo
 * fixtures and the client-side filter. A target is either a LinkedIn member
 * (`accountId`) or a page (`accountId|pageId`) — the same value the composer
 * stores as `social_page_id` + `social_account_id`.
 */

import type {
  EngagementTotals,
  PostStatus,
  PublishTargetOption,
  SocialProvider,
  TargetType,
} from "./types";

export type ParsedTarget = {
  accountId: string;
  pageId: string | null;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TARGET_PATTERN = new RegExp(`^${UUID}(\\|${UUID})?$`, "i");

/** Build the URL/select value for an account or account+page pair. */
export function targetValue(accountId: string, pageId?: string | null) {
  return pageId ? `${accountId}|${pageId}` : accountId;
}

/** Parse and validate a `?target=` query value. Returns null for junk input. */
export function parseTargetParam(value: string | null | undefined): ParsedTarget | null {
  const trimmed = value?.trim();
  if (!trimmed || !TARGET_PATTERN.test(trimmed)) return null;
  const [accountId, pageId] = trimmed.split("|");
  return { accountId, pageId: pageId || null };
}

/** True when a post belongs to the selected target (or when nothing is selected). */
export function matchesTarget(
  post: { social_account_id: string | null; social_page_id: string | null },
  target: ParsedTarget | null,
) {
  if (!target) return true;
  if (post.social_account_id !== target.accountId) return false;
  return target.pageId ? post.social_page_id === target.pageId : post.social_page_id === null;
}

export type TargetStatusCounts = Record<PostStatus, number> & { total: number };

/** Everything the UI needs to show one account or page on its own. */
export type TargetSummary = {
  /** `accountId` for members, `accountId|pageId` for pages. */
  value: string;
  accountId: string;
  pageId: string | null;
  label: string;
  subtitle: string;
  provider: SocialProvider;
  targetType: TargetType;
  avatarUrl: string | null;
  canPublish: boolean;
  counts: TargetStatusCounts;
  engagement: EngagementTotals;
  lastPublishedAt: string | null;
};

export type TargetPostRow = {
  social_account_id: string | null;
  social_page_id: string | null;
  status: PostStatus;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  published_at: string | null;
};

export function emptyStatusCounts(): TargetStatusCounts {
  return {
    total: 0,
    draft: 0,
    scheduled: 0,
    processing: 0,
    published: 0,
    failed: 0,
    cancelled: 0,
  };
}

/**
 * Aggregate posts into per-target counters. Kept pure so the demo workspace,
 * the page list, the dashboard filter and the unit tests share one rule.
 */
export function summarizeTargets(
  targets: PublishTargetOption[],
  posts: TargetPostRow[],
): TargetSummary[] {
  const summaries = new Map<string, TargetSummary>(
    targets.map((target) => [
      target.value,
      {
        value: target.value,
        accountId: target.accountId,
        pageId: target.pageId,
        label: target.label,
        subtitle: target.subtitle,
        provider: target.platform,
        targetType: target.targetType,
        avatarUrl: target.avatarUrl,
        canPublish: target.canPublish,
        counts: emptyStatusCounts(),
        engagement: { likes: 0, comments: 0, shares: 0 },
        lastPublishedAt: null,
      },
    ]),
  );

  for (const post of posts) {
    const key = post.social_page_id
      ? `${post.social_account_id ?? ""}|${post.social_page_id}`
      : post.social_account_id;
    const summary = key ? summaries.get(key) : undefined;
    if (!summary) continue;

    summary.counts.total += 1;
    summary.counts[post.status] += 1;
    if (post.status !== "published") continue;

    summary.engagement.likes += post.like_count ?? 0;
    summary.engagement.comments += post.comment_count ?? 0;
    summary.engagement.shares += post.share_count ?? 0;
    if (
      post.published_at &&
      (!summary.lastPublishedAt || post.published_at > summary.lastPublishedAt)
    ) {
      summary.lastPublishedAt = post.published_at;
    }
  }

  return targets.map((target) => summaries.get(target.value)!);
}
