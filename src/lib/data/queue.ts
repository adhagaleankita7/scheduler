import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { demoPosts, demoQueueSettings } from "@/lib/demo/fixtures";
import { hydratePosts, signedMediaUrls } from "@/lib/data/hydrate";
import { getAccountsOverview } from "@/lib/data/accounts";
import { nextQueueSlots, type QueueSlot } from "@/lib/scheduling/slots";
import type { Post, PostWithRelations, QueueSettings } from "@/lib/types";

export type QueueData = {
  settings: QueueSettings;
  scheduled: PostWithRelations[];
  drafts: PostWithRelations[];
  nextSlots: QueueSlot[];
  nextPublishAt: string | null;
  targets: Awaited<ReturnType<typeof getAccountsOverview>>["targets"];
  accounts: Awaited<ReturnType<typeof getAccountsOverview>>["accounts"];
  pages: Awaited<ReturnType<typeof getAccountsOverview>>["pages"];
  demo: boolean;
  signedMedia: Record<string, string>;
};

function normalizeTimes(times: string[]) {
  return times.map((time) => time.slice(0, 5));
}

export async function getQueueData(): Promise<QueueData> {
  const session = await requireSession();
  const overview = await getAccountsOverview();
  const now = new Date();

  if (session.demo) {
    const settings = demoQueueSettings();
    const posts = demoPosts();
    const scheduled = posts
      .filter((post) => post.status === "scheduled")
      .sort((a, b) => new Date(a.scheduled_for ?? 0).getTime() - new Date(b.scheduled_for ?? 0).getTime());
    const drafts = posts.filter((post) => post.status === "draft");
    const lastScheduled = scheduled.reduce<string | null>((latest, post) => {
      if (!post.scheduled_for) return latest;
      if (!latest || new Date(post.scheduled_for) > new Date(latest)) return post.scheduled_for;
      return latest;
    }, null);
    const nextSlots = nextQueueSlots({
      now,
      timeZone: settings.timezone,
      postingDays: settings.posting_days,
      postingTimes: normalizeTimes(settings.posting_times),
      count: 7,
      startAfter: lastScheduled ? new Date(lastScheduled) : null,
    });
    return {
      settings,
      scheduled,
      drafts,
      nextSlots,
      nextPublishAt: scheduled[0]?.scheduled_for ?? nextSlots[0]?.iso ?? null,
      targets: overview.targets,
      accounts: overview.accounts,
      pages: overview.pages,
      demo: true,
      signedMedia: {},
    };
  }

  const supabase = await createClient();
  const workspaceId = session.workspace.id;

  const [settingsResult, scheduledResult, draftsResult] = await Promise.all([
    supabase.from("queue_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    supabase
      .from("posts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled")
      .order("scheduled_for", { ascending: true }),
    supabase
      .from("posts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const settings =
    (settingsResult.data as QueueSettings | null) ?? {
      workspace_id: workspaceId,
      user_id: session.user.id,
      timezone: session.profile.timezone,
      posting_days: session.profile.default_posting_days,
      posting_times: [session.profile.default_posting_time],
      is_paused: false,
      last_assigned_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

  const scheduled = await hydratePosts(supabase, (scheduledResult.data ?? []) as Post[]);
  const drafts = await hydratePosts(supabase, (draftsResult.data ?? []) as Post[]);
  const signedMedia = await signedMediaUrls(supabase, [...scheduled, ...drafts]);

  const lastScheduled = scheduled.reduce<string | null>((latest, post) => {
    if (!post.scheduled_for) return latest;
    if (!latest || new Date(post.scheduled_for) > new Date(latest)) return post.scheduled_for;
    return latest;
  }, null);

  const nextSlots = nextQueueSlots({
    now,
    timeZone: settings.timezone,
    postingDays: settings.posting_days,
    postingTimes: normalizeTimes(settings.posting_times),
    count: 7,
    startAfter: lastScheduled ? new Date(lastScheduled) : null,
  });

  return {
    settings,
    scheduled,
    drafts,
    nextSlots,
    nextPublishAt: scheduled[0]?.scheduled_for ?? nextSlots[0]?.iso ?? null,
    targets: overview.targets,
    accounts: overview.accounts,
    pages: overview.pages,
    demo: false,
    signedMedia,
  };
}
