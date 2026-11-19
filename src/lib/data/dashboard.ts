import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { demoDashboardData } from "@/lib/demo/fixtures";
import { hydratePosts } from "@/lib/data/hydrate";
import {
  addDaysToDateKey,
  formatInZone,
  todayDateKey,
  zonedDateTimeToUtc,
} from "@/lib/scheduling/timezone";
import type { ActivityPoint, DashboardData, Post, PostStatus } from "@/lib/types";

async function countPosts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  status?: PostStatus,
) {
  let query = supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (status) query = query.eq("status", status);
  const { count } = await query;
  return count ?? 0;
}

export async function getDashboardData(): Promise<DashboardData & { demo: boolean; timezone: string }> {
  const session = await requireSession();
  const timezone = session.profile.timezone || "Asia/Kolkata";

  if (session.demo) {
    return { ...demoDashboardData(), demo: true, timezone };
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
  ] = await Promise.all([
    countPosts(supabase, workspaceId),
    countPosts(supabase, workspaceId, "scheduled"),
    countPosts(supabase, workspaceId, "published"),
    countPosts(supabase, workspaceId, "draft"),
    countPosts(supabase, workspaceId, "failed"),
    supabase
      .from("posts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled")
      .gte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("posts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled")
      .gte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(5),
    supabase
      .from("posts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("status", ["published", "failed"])
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("posts")
      .select("scheduled_for, status")
      .eq("workspace_id", workspaceId)
      .not("scheduled_for", "is", null)
      .gte("scheduled_for", startIso)
      .lt("scheduled_for", endIso),
    supabase
      .from("posts")
      .select("published_at")
      .eq("workspace_id", workspaceId)
      .not("published_at", "is", null)
      .gte("published_at", startIso)
      .lt("published_at", endIso),
    supabase
      .from("publishing_logs")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "failure")
      .gte("created_at", startIso)
      .lt("created_at", endIso),
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
      (row) => formatInZone(row.created_at, timezone, "yyyy-MM-dd") === dateKey,
    ).length;
    return { date: dateKey, scheduled, published, failed };
  });

  return {
    counts: {
      total,
      scheduled: scheduledCount,
      published: publishedCount,
      draft: draftCount,
      failed: failedCount,
    },
    nextPost,
    recent,
    upcoming,
    activity,
    weeklyTarget: session.profile.default_posting_days?.length || 7,
    demo: false,
    timezone,
  };
}
