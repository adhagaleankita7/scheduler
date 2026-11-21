import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { demoDashboardData } from "@/lib/demo/fixtures";
import { hydratePosts } from "@/lib/data/hydrate";
import { parseTargetParam, type ParsedTarget } from "@/lib/targets";
import {
  addDaysToDateKey,
  formatInZone,
  todayDateKey,
  zonedDateTimeToUtc,
} from "@/lib/scheduling/timezone";
import type {
  ActivityPoint,
  DashboardData,
  EngagementTotals,
  Post,
  PostStatus,
} from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Start a posts query already scoped to the workspace (RLS) and, when the user
 * picked a page in the dashboard filter, to that exact target.
 */
function postsQuery(supabase: Supabase, workspaceId: string, target: ParsedTarget | null) {
  let query = supabase.from("posts").select("*").eq("workspace_id", workspaceId);
  if (target) {
    query = query.eq("social_account_id", target.accountId);
    query = target.pageId
      ? query.eq("social_page_id", target.pageId)
      : query.is("social_page_id", null);
  }
  return query;
}

function postCountQuery(
  supabase: Supabase,
  workspaceId: string,
  target: ParsedTarget | null,
  status?: PostStatus,
) {
  let query = supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (status) query = query.eq("status", status);
  if (target) {
    query = query.eq("social_account_id", target.accountId);
    query = target.pageId
      ? query.eq("social_page_id", target.pageId)
      : query.is("social_page_id", null);
  }
  return query;
}

async function countPosts(
  supabase: Supabase,
  workspaceId: string,
  target: ParsedTarget | null,
  status?: PostStatus,
) {
  const { count } = await postCountQuery(supabase, workspaceId, target, status);
  return count ?? 0;
}

export async function getDashboardData(
  options: { target?: string } = {},
): Promise<DashboardData & { demo: boolean; timezone: string }> {
  const session = await requireSession();
  const timezone = session.profile.timezone || "Asia/Kolkata";
  const target = parseTargetParam(options.target);

  if (session.demo) {
    return { ...demoDashboardData(target), demo: true, timezone };
  }

  const supabase = await createClient();
  const workspaceId = session.workspace.id;
  const now = new Date();
  const nowIso = now.toISOString();
  const today = todayDateKey(timezone, now);
  const startDateKey = addDaysToDateKey(today, -6);
  const startIso = zonedDateTimeToUtc(startDateKey, "00:00", timezone).toISOString();
  const endIso = zonedDateTimeToUtc(addDaysToDateKey(today, 1), "00:00", timezone).toISOString();

  const [
    total,
    scheduledCount,
    publishedCount,
    draftCount,
    failedCount,
    nextResult,
    upcomingResult,
    recentResult,
    activityResult,
    publishedActivityResult,
    failedActivityResult,
    engagementResult,
  ] = await Promise.all([
    countPosts(supabase, workspaceId, target),
    countPosts(supabase, workspaceId, target, "scheduled"),
    countPosts(supabase, workspaceId, target, "published"),
    countPosts(supabase, workspaceId, target, "draft"),
    countPosts(supabase, workspaceId, target, "failed"),
    postsQuery(supabase, workspaceId, target)
      .eq("status", "scheduled")
      .gte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .maybeSingle(),
    postsQuery(supabase, workspaceId, target)
      .eq("status", "scheduled")
      .gte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(5),
    postsQuery(supabase, workspaceId, target)
      .in("status", ["published", "failed"])
      .order("updated_at", { ascending: false })
      .limit(5),
    postsQuery(supabase, workspaceId, target)
      .not("scheduled_for", "is", null)
      .gte("scheduled_for", startIso)
      .lt("scheduled_for", endIso),
    postsQuery(supabase, workspaceId, target)
      .not("published_at", "is", null)
      .gte("published_at", startIso)
      .lt("published_at", endIso),
    // Failures are counted from posts (not publishing_logs) so the number can
    // be scoped to the selected page.
    postsQuery(supabase, workspaceId, target)
      .eq("status", "failed")
      .gte("updated_at", startIso)
      .lt("updated_at", endIso),
    (() => {
      let query = supabase
        .from("posts")
        .select("like_count, comment_count, share_count")
        .eq("workspace_id", workspaceId)
        .eq("status", "published");
      if (target) {
        query = query.eq("social_account_id", target.accountId);
        query = target.pageId
          ? query.eq("social_page_id", target.pageId)
          : query.is("social_page_id", null);
      }
      return query;
    })(),
  ]);

  const nextPost = nextResult.data
    ? (await hydratePosts(supabase, [nextResult.data as Post]))[0] ?? null
    : null;
  const upcoming = await hydratePosts(supabase, (upcomingResult.data ?? []) as Post[]);
  const recent = await hydratePosts(supabase, (recentResult.data ?? []) as Post[]);

  const activity: ActivityPoint[] = Array.from({ length: 7 }).map((_, index) => {
    const dateKey = addDaysToDateKey(today, index - 6);
    const scheduled =
      (activityResult.data ?? []).filter(
        (row) => row.scheduled_for && formatInZone(row.scheduled_for, timezone, "yyyy-MM-dd") === dateKey,
      ).length;
    const published = (publishedActivityResult.data ?? []).filter(
      (row) => row.published_at && formatInZone(row.published_at, timezone, "yyyy-MM-dd") === dateKey,
    ).length;
    const failed = (failedActivityResult.data ?? []).filter(
      (row) => formatInZone(row.updated_at, timezone, "yyyy-MM-dd") === dateKey,
    ).length;
    return { date: dateKey, scheduled, published, failed };
  });

  const engagement = (engagementResult.data ?? []).reduce<EngagementTotals>(
    (totals, row) => ({
      likes: totals.likes + (row.like_count ?? 0),
      comments: totals.comments + (row.comment_count ?? 0),
      shares: totals.shares + (row.share_count ?? 0),
    }),
    { likes: 0, comments: 0, shares: 0 },
  );

  return {
    counts: {
      total,
      scheduled: scheduledCount,
      published: publishedCount,
      draft: draftCount,
      failed: failedCount,
    },
    engagement,
    nextPost,
    recent,
    upcoming,
    activity,
    weeklyTarget: session.profile.default_posting_days?.length || 7,
    demo: false,
    timezone,
  };
}
