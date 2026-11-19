"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/session";
import { resolveTarget } from "@/lib/data/accounts";
import { nextQueueSlots } from "@/lib/scheduling/slots";
import { normalizeTime } from "@/lib/scheduling/timezone";
import { decodeTarget, postContentSchema } from "@/lib/validation";
import type { ActionResult, Post, QueueSettings } from "@/lib/types";

const DEMO_ERROR =
  "This is a read-only demo workspace. Connect Supabase and sign in to save changes.";

const addToQueueSchema = z.object({
  content: postContentSchema,
  target: z.string().min(1),
  queueId: z.string().optional(),
});

const queueSettingsSchema = z.object({
  timezone: z.string().min(1),
  postingDays: z.array(z.number().int().min(1).max(7)).min(1, "Select at least one day"),
  postingTimes: z
    .array(z.string().refine((value) => normalizeTime(value) !== null, "Invalid time"))
    .min(1, "Add at least one time")
    .max(4, "Up to four daily slots are supported"),
  isPaused: z.boolean().optional(),
});

function revalidateQueue() {
  revalidatePath("/queue");
  revalidatePath("/dashboard");
  revalidatePath("/posts");
  revalidatePath("/calendar");
}

function normalizeTimes(times: string[]) {
  return times.map((time) => normalizeTime(time) ?? "10:00");
}

export async function addToQueue(input: {
  content: string;
  target: string;
  queueId?: string;
}): Promise<ActionResult<{ id: string; scheduledFor: string }>> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const parsed = addToQueueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the post content." };
  }
  const { accountId, pageId } = decodeTarget(parsed.data.target);
  const target = await resolveTarget(session.workspace.id, accountId, pageId);
  if (!target.ok) return { ok: false, error: target.error };

  const supabase = await createClient();
  const workspaceId = session.workspace.id;

  const [settingsResult, scheduledResult, positionResult] = await Promise.all([
    supabase.from("queue_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    supabase
      .from("posts")
      .select("scheduled_for")
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled")
      .not("scheduled_for", "is", null)
      .order("scheduled_for", { ascending: false })
      .limit(1),
    supabase
      .from("posts")
      .select("queue_position")
      .eq("workspace_id", workspaceId)
      .not("queue_position", "is", null)
      .order("queue_position", { ascending: false })
      .limit(1),
  ]);

  const settings = (settingsResult.data as QueueSettings | null) ?? {
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

  if (settings.is_paused) {
    return {
      ok: false,
      error: "Your queue is paused. Resume it before adding new posts.",
    };
  }

  const lastScheduled = scheduledResult.data?.[0]?.scheduled_for as string | undefined;
  const [slot] = nextQueueSlots({
    now: new Date(),
    timeZone: settings.timezone,
    postingDays: settings.posting_days,
    postingTimes: normalizeTimes(settings.posting_times),
    count: 1,
    startAfter: lastScheduled ? new Date(lastScheduled) : null,
  });

  if (!slot) {
    return {
      ok: false,
      error: "No queue slots are available. Check your posting days and times in Queue settings.",
    };
  }

  const maxPosition = positionResult.data?.[0]?.queue_position ?? 0;

  const { data: created, error } = await supabase
    .from("posts")
    .insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      content: parsed.data.content,
      target_type: target.targetType,
      social_account_id: accountId,
      social_page_id: pageId,
      status: "scheduled",
      scheduled_for: slot.iso,
      queue_position: (maxPosition ?? 0) + 1,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: `Could not add the post to the queue: ${error?.message ?? ""}` };
  }

  revalidateQueue();
  return {
    ok: true,
    data: { id: created.id, scheduledFor: slot.iso },
    message: "Added to the next available slot",
  };
}

export async function scheduleDraftInQueue(
  postId: string,
): Promise<ActionResult<{ scheduledFor: string }>> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  if (!z.string().uuid().safeParse(postId).success) return { ok: false, error: "Invalid post." };

  const supabase = await createClient();
  const workspaceId = session.workspace.id;

  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("id, status, social_account_id, social_page_id")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle<Pick<Post, "id" | "status" | "social_account_id" | "social_page_id">>();

  if (postError) return { ok: false, error: `Could not load that post: ${postError.message}` };
  if (!post) return { ok: false, error: "That post could not be found." };
  if (post.status !== "draft") {
    return { ok: false, error: "Only draft posts can be promoted into the queue." };
  }
  if (!post.social_account_id) {
    return { ok: false, error: "Reconnect the account and choose a target before queuing this post." };
  }

  const [settingsResult, scheduledResult] = await Promise.all([
    supabase.from("queue_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    supabase
      .from("posts")
      .select("scheduled_for")
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled")
      .not("scheduled_for", "is", null)
      .order("scheduled_for", { ascending: false })
      .limit(1),
  ]);

  const settings = (settingsResult.data as QueueSettings | null) ?? {
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

  if (settings.is_paused) {
    return { ok: false, error: "Your queue is paused. Resume it before adding drafts." };
  }

  const lastScheduled = scheduledResult.data?.[0]?.scheduled_for as string | undefined;
  const [slot] = nextQueueSlots({
    now: new Date(),
    timeZone: settings.timezone,
    postingDays: settings.posting_days,
    postingTimes: normalizeTimes(settings.posting_times),
    count: 1,
    startAfter: lastScheduled ? new Date(lastScheduled) : null,
  });

  if (!slot) {
    return {
      ok: false,
      error: "No queue slots are available. Check your posting days and times.",
    };
  }

  const { data: updated, error } = await supabase
    .from("posts")
    .update({ status: "scheduled", scheduled_for: slot.iso })
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .eq("status", "draft")
    .select("id");

  if (error) return { ok: false, error: `Could not queue that draft: ${error.message}` };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "That draft changed while you were queueing it. Refresh and try again." };
  }

  revalidateQueue();
  return {
    ok: true,
    data: { scheduledFor: slot.iso },
    message: "Draft queued for its next available slot",
  };
}

export async function reorderQueue(
  postId: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const supabase = await createClient();
  const workspaceId = session.workspace.id;
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "scheduled")
    .not("scheduled_for", "is", null)
    .order("scheduled_for", { ascending: true })
    .limit(200);

  if (error) return { ok: false, error: `Could not load the queue: ${error.message}` };
  const posts = (data ?? []) as Post[];
  const index = posts.findIndex((post) => post.id === postId);
  if (index === -1) return { ok: false, error: "That post is not in the queue." };

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= posts.length) {
    return { ok: false, error: direction === "up" ? "This post is already first." : "This post is already last." };
  }

  const current = posts[index];
  const neighbour = posts[swapIndex];
  if (!current.scheduled_for || !neighbour.scheduled_for) {
    return { ok: false, error: "Both posts need a scheduled time to be reordered." };
  }

  const [first, second] =
    direction === "up"
      ? [
          { id: current.id, time: neighbour.scheduled_for },
          { id: neighbour.id, time: current.scheduled_for },
        ]
      : [
          { id: current.id, time: neighbour.scheduled_for },
          { id: neighbour.id, time: current.scheduled_for },
        ];

  const resultOne = await supabase
    .from("posts")
    .update({ scheduled_for: first.time })
    .eq("id", first.id)
    .eq("workspace_id", workspaceId)
    .eq("status", "scheduled")
    .select("id");
  if (resultOne.error) return { ok: false, error: `Could not reorder: ${resultOne.error.message}` };
  if (!resultOne.data || resultOne.data.length === 0) {
    return { ok: false, error: "The queue changed while reordering. Refresh and try again." };
  }

  const resultTwo = await supabase
    .from("posts")
    .update({ scheduled_for: second.time })
    .eq("id", second.id)
    .eq("workspace_id", workspaceId)
    .eq("status", "scheduled")
    .select("id");
  if (resultTwo.error || !resultTwo.data || resultTwo.data.length === 0) {
    await supabase
      .from("posts")
      .update({ scheduled_for: current.scheduled_for })
      .eq("id", current.id)
      .eq("workspace_id", workspaceId);
    return {
      ok: false,
      error: `Could not reorder: ${resultTwo.error?.message ?? "the queue changed. Refresh and try again."}`,
    };
  }

  revalidateQueue();
  return { ok: true, message: "Queue reordered" };
}

export async function updateQueueSettings(input: {
  timezone: string;
  postingDays: number[];
  postingTimes: string[];
  isPaused?: boolean;
}): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const parsed = queueSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid queue settings." };
  }
  const data = parsed.data;
  const times = Array.from(new Set(normalizeTimes(data.postingTimes))).sort();
  const days = Array.from(new Set(data.postingDays)).sort((a, b) => a - b);

  const supabase = await createClient();
  const { error } = await supabase.from("queue_settings").upsert(
    {
      workspace_id: session.workspace.id,
      user_id: session.user.id,
      timezone: data.timezone,
      posting_days: days,
      posting_times: times.map((time) => `${time}:00`),
      is_paused: data.isPaused ?? false,
    },
    { onConflict: "workspace_id" },
  );
  if (error) return { ok: false, error: `Could not save queue settings: ${error.message}` };

  await supabase
    .from("profiles")
    .update({
      timezone: data.timezone,
      default_posting_time: `${times[0]}:00`,
      default_posting_days: days,
    })
    .eq("id", session.user.id);

  revalidateQueue();
  revalidatePath("/settings");
  return { ok: true, message: "Queue settings saved" };
}

export async function toggleQueuePaused(paused: boolean): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const supabase = await createClient();
  const workspaceId = session.workspace.id;
  // Only touch is_paused. An upsert here used to rewrite timezone/days/times
  // from stale profile defaults, silently discarding saved queue settings.
  const { data: updated, error } = await supabase
    .from("queue_settings")
    .update({ is_paused: paused })
    .eq("workspace_id", workspaceId)
    .select("workspace_id");

  if (error) return { ok: false, error: `Could not update the queue: ${error.message}` };

  if (!updated || updated.length === 0) {
    const { error: insertError } = await supabase.from("queue_settings").insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      timezone: session.profile.timezone,
      posting_days: session.profile.default_posting_days,
      posting_times: [session.profile.default_posting_time],
      is_paused: paused,
    });
    if (insertError) {
      return { ok: false, error: `Could not update the queue: ${insertError.message}` };
    }
  }

  revalidateQueue();
  return {
    ok: true,
    message: paused
      ? "Queue paused. Posts stay queued and resume exactly where they left off."
      : "Queue resumed. The publisher will continue on the next minute.",
  };
}
