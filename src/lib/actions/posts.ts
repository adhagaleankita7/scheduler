"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/session";
import { isServiceRoleConfigured } from "@/lib/env";
import { resolveTarget } from "@/lib/data/accounts";
import {
  MAX_POST_LENGTH,
  decodeTarget,
  savePostSchema,
  scheduleWeekSchema,
  type SavePostInput,
} from "@/lib/validation";
import type { ActionResult, Post, PostStatus } from "@/lib/types";

const DEMO_ERROR =
  "This is a read-only demo workspace. Connect Supabase and sign in to save changes.";

const EDITABLE_STATUSES: PostStatus[] = ["draft", "scheduled", "failed", "cancelled"];

async function nudgeScheduler() {
  if (!isServiceRoleConfigured()) return;
  try {
    const admin = createAdminClient();
    await admin.rpc("trigger_publish_function");
  } catch {
    // The pg_cron job will pick the post up on its next minute.
  }
}

async function removeStorageObject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string | null | undefined,
) {
  if (!path) return;
  await supabase.storage.from("post-media").remove([path]);
}

/**
 * A collaborator may attach an image they uploaded themselves, or reuse an
 * image that already belongs to a post in the shared workspace (for example
 * when editing a post the owner created).
 */
async function canUseMediaPath(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
  path: string,
) {
  if (path.startsWith(`${userId}/`)) return true;
  const { data } = await supabase
    .from("post_media")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("storage_path", path)
    .maybeSingle();
  return Boolean(data);
}

function revalidateWorkspace() {
  revalidatePath("/dashboard");
  revalidatePath("/posts");
  revalidatePath("/queue");
  revalidatePath("/calendar");
  revalidatePath("/planner");
}

function fieldErrorsFrom(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    fieldErrors[issue.path.join(".") || "form"] = issue.message;
  }
  return fieldErrors;
}

function extForMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export async function savePost(
  input: SavePostInput,
): Promise<ActionResult<{ id: string; status: PostStatus }>> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const parsed = savePostSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }
  const data = parsed.data;
  const { accountId, pageId } = decodeTarget(data.target);
  const target = await resolveTarget(session.workspace.id, accountId, pageId);
  if (!target.ok) return { ok: false, error: target.error };

  const supabase = await createClient();
  const workspaceId = session.workspace.id;
  const now = new Date();

  let scheduledFor: string | null = null;
  let status: PostStatus = "draft";

  if (data.mode === "schedule") {
    if (!data.scheduledFor) {
      return { ok: false, error: "Choose a date and time to schedule this post.", fieldErrors: { scheduledFor: "Required" } };
    }
    const date = new Date(data.scheduledFor);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: "That date and time is invalid.", fieldErrors: { scheduledFor: "Invalid date" } };
    }
    if (date.getTime() < now.getTime() - 30_000) {
      return {
        ok: false,
        error: "The scheduled time is in the past. Choose a future time.",
        fieldErrors: { scheduledFor: "Choose a future time" },
      };
    }
    scheduledFor = date.toISOString();
    status = "scheduled";
  } else if (data.mode === "now") {
    scheduledFor = now.toISOString();
    status = "scheduled";
  }

  if (data.mediaPath) {
    if (!(await canUseMediaPath(supabase, workspaceId, session.user.id, data.mediaPath))) {
      return { ok: false, error: "The uploaded image does not belong to your workspace." };
    }
    if (!data.mediaMimeType || !["image/jpeg", "image/png", "image/webp"].includes(data.mediaMimeType)) {
      return { ok: false, error: "Images must be JPEG, PNG or WebP." };
    }
  }

  if (data.id) {
    const { data: existing } = await supabase
      .from("posts")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle<Post>();

    if (!existing) return { ok: false, error: "That post could not be found." };
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      return {
        ok: false,
        error:
          existing.status === "published"
            ? "Published posts can't be edited. Duplicate it to reuse the content."
            : "This post is currently being published and can't be edited.",
      };
    }

    const { data: updated, error } = await supabase
      .from("posts")
      .update({
        content: data.content,
        target_type: target.targetType,
        social_account_id: accountId,
        social_page_id: pageId,
        scheduled_for: scheduledFor,
        status,
      })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .eq("status", existing.status)
      .select("id");

    if (error) return { ok: false, error: `Could not update the post: ${error.message}` };
    if (!updated || updated.length === 0) {
      return {
        ok: false,
        error: "This post changed while you were editing it. Refresh and try again.",
      };
    }

    if (data.mediaPath) {
      const { data: oldMedia } = await supabase
        .from("post_media")
        .select("storage_path")
        .eq("post_id", data.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (oldMedia?.storage_path && oldMedia.storage_path !== data.mediaPath) {
        await removeStorageObject(supabase, oldMedia.storage_path);
        await supabase.from("post_media").delete().eq("post_id", data.id).eq("workspace_id", workspaceId);
      }
      const { error: mediaError } = await supabase.from("post_media").upsert(
        {
          workspace_id: workspaceId,
          post_id: data.id,
          user_id: session.user.id,
          storage_path: data.mediaPath,
          mime_type: data.mediaMimeType!,
          alt_text: data.mediaAlt?.slice(0, 300) || null,
        },
        { onConflict: "post_id" },
      );
      if (mediaError) return { ok: false, error: `Could not attach the image: ${mediaError.message}` };
    } else {
      // The image was removed in the composer (or never existed): clear both
      // the row and the stored object instead of leaving an orphan behind.
      const { data: oldMedia } = await supabase
        .from("post_media")
        .select("storage_path")
        .eq("post_id", data.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (oldMedia?.storage_path) {
        await removeStorageObject(supabase, oldMedia.storage_path);
        await supabase.from("post_media").delete().eq("post_id", data.id).eq("workspace_id", workspaceId);
      }
    }

    if (status === "scheduled" && new Date(scheduledFor!).getTime() <= now.getTime() + 60_000) {
      await nudgeScheduler();
    }
    revalidateWorkspace();
    revalidatePath("/composer");
    return { ok: true, data: { id: data.id, status }, message: status === "scheduled" ? "Post scheduled" : "Draft saved" };
  }

  const { data: created, error } = await supabase
    .from("posts")
    .insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      content: data.content,
      target_type: target.targetType,
      social_account_id: accountId,
      social_page_id: pageId,
      schedule_id: data.scheduleId ?? null,
      scheduled_for: scheduledFor,
      status,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: `Could not create the post: ${error?.message ?? "unknown error"}` };
  }

  if (data.mediaPath) {
    const { error: mediaError } = await supabase.from("post_media").insert({
      workspace_id: workspaceId,
      post_id: created.id,
      user_id: session.user.id,
      storage_path: data.mediaPath,
      mime_type: data.mediaMimeType!,
      alt_text: data.mediaAlt?.slice(0, 300) || null,
    });
    if (mediaError) {
      await supabase.from("posts").delete().eq("id", created.id).eq("workspace_id", workspaceId);
      return { ok: false, error: `Could not attach the image: ${mediaError.message}` };
    }
  }

  if (status === "scheduled" && new Date(scheduledFor!).getTime() <= now.getTime() + 60_000) {
    await nudgeScheduler();
  }
  revalidateWorkspace();
  return {
    ok: true,
    data: { id: created.id, status },
    message:
      data.mode === "now"
        ? "Publishing now — your post will be live shortly."
        : data.mode === "schedule"
          ? "Post scheduled"
          : "Draft saved",
  };
}

export async function scheduleWeek(
  input: z.infer<typeof scheduleWeekSchema>,
): Promise<ActionResult<{ ids: string[]; scheduleId: string }>> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const parsed = scheduleWeekSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please check your publishing plan.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }
  const data = parsed.data;
  const { accountId, pageId } = decodeTarget(data.target);
  const target = await resolveTarget(session.workspace.id, accountId, pageId);
  if (!target.ok) return { ok: false, error: target.error };

  const supabase = await createClient();
  const workspaceId = session.workspace.id;

  const entries = data.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.content.trim().length > 0);
  if (entries.length === 0) {
    return { ok: false, error: "Add content to at least one day before scheduling." };
  }

  const now = new Date();
  const fieldErrors: Record<string, string> = {};
  const rows = await Promise.all(
    entries.map(async ({ entry, index: entryIndex }) => {
      const content = entry.content.trim();
      if (content.length > MAX_POST_LENGTH) {
        fieldErrors[`entries.${entryIndex}.content`] = `Keep posts under ${MAX_POST_LENGTH.toLocaleString()} characters.`;
      }
      let instant: string | null = null;
      try {
        instant = fromZonedTime(
          `${entry.dateKey}T${entry.time}:00`,
          data.timezone,
        ).toISOString();
      } catch {
        fieldErrors[`entries.${entryIndex}.time`] = "Invalid date/time.";
      }
      if (instant && new Date(instant).getTime() < now.getTime() - 30_000) {
        fieldErrors[`entries.${entryIndex}.time`] = "This slot is in the past. Move it forward.";
      }

      const mediaPath = entry.mediaPath?.trim() || null;
      const mediaMimeType = entry.mediaMimeType?.trim() || null;
      if (mediaPath) {
        if (!(await canUseMediaPath(supabase, workspaceId, session.user.id, mediaPath))) {
          fieldErrors[`entries.${entryIndex}.mediaPath`] =
            "That image does not belong to your workspace.";
        } else if (
          !mediaMimeType ||
          !["image/jpeg", "image/png", "image/webp"].includes(mediaMimeType)
        ) {
          fieldErrors[`entries.${entryIndex}.mediaMimeType`] = "Images must be JPEG, PNG or WebP.";
        }
      }

      return {
        entry,
        content,
        instant,
        mediaPath,
        mediaMimeType,
        mediaAlt: entry.mediaAlt?.trim() || null,
      };
    }),
  );

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Some posts have invalid content or times.", fieldErrors };
  }

  // Times arrive as UTC ISO strings from the client; recompute defensively.
  const ids = rows.map(() => crypto.randomUUID());
  const startDate = data.entries[0]?.dateKey ?? new Date().toISOString().slice(0, 10);
  const endDate = data.entries[data.entries.length - 1]?.dateKey ?? startDate;

  const { data: schedule, error: scheduleError } = await supabase
    .from("publishing_schedules")
    .insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      name: data.name,
      timezone: data.timezone,
      start_date: startDate,
      end_date: endDate,
      target_type: target.targetType,
      social_account_id: accountId,
      social_page_id: pageId,
      status: "active",
    })
    .select("id")
    .single();

  if (scheduleError || !schedule) {
    return { ok: false, error: `Could not create the publishing plan: ${scheduleError?.message ?? ""}` };
  }

  // Wall-clock times are converted to UTC on the server using the selected
  // IANA timezone, so client clocks/timezones are never trusted.
  const rowsPayload = rows.map(({ content, instant }, index) => ({
    id: ids[index],
    workspace_id: workspaceId,
    user_id: session.user.id,
    content,
    target_type: target.targetType,
    social_account_id: accountId,
    social_page_id: pageId,
    schedule_id: schedule.id,
    scheduled_for: instant,
    status: data.action === "schedule" ? "scheduled" : "draft",
    queue_position: index + 1,
  }));

  const { error: postError } = await supabase.from("posts").insert(rowsPayload);
  if (postError) {
    await supabase.from("publishing_schedules").delete().eq("id", schedule.id).eq("workspace_id", workspaceId);
    return { ok: false, error: `Could not schedule the posts: ${postError.message}` };
  }

  const mediaPayload = rows.flatMap(({ mediaPath, mediaMimeType, mediaAlt }, index) =>
    mediaPath
      ? [
          {
            workspace_id: workspaceId,
            post_id: ids[index],
            user_id: session.user.id,
            storage_path: mediaPath,
            mime_type: mediaMimeType!,
            alt_text: mediaAlt?.slice(0, 300) || null,
          },
        ]
      : [],
  );

  if (mediaPayload.length > 0) {
    const { error: mediaError } = await supabase.from("post_media").insert(mediaPayload);
    if (mediaError) {
      await supabase.from("posts").delete().in("id", ids).eq("workspace_id", workspaceId);
      await supabase
        .from("publishing_schedules")
        .delete()
        .eq("id", schedule.id)
        .eq("workspace_id", workspaceId);
      return { ok: false, error: `Could not attach the images: ${mediaError.message}` };
    }
  }

  if (data.action === "schedule") await nudgeScheduler();
  revalidateWorkspace();
  return {
    ok: true,
    data: { ids, scheduleId: schedule.id },
    message:
      data.action === "schedule"
        ? `${rowsPayload.length} post${rowsPayload.length === 1 ? "" : "s"} scheduled`
        : `${rowsPayload.length} draft${rowsPayload.length === 1 ? "" : "s"} saved`,
  };
}

export async function reschedulePost(
  postId: string,
  scheduledFor: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  if (!z.string().uuid().safeParse(postId).success) return { ok: false, error: "Invalid post." };
  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime())) return { ok: false, error: "Invalid date and time." };
  if (date.getTime() < Date.now() - 30_000) {
    return { ok: false, error: "Choose a future time for this post." };
  }

  const supabase = await createClient();
  const workspaceId = session.workspace.id;
  const { data: post } = await supabase
    .from("posts")
    .select("id, status, user_id")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle<Post>();

  if (!post) return { ok: false, error: "That post could not be found." };
  if (!EDITABLE_STATUSES.includes(post.status)) {
    return { ok: false, error: "Published or in-flight posts can't be rescheduled." };
  }
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      error:
        "Rescheduling needs SUPABASE_SERVICE_ROLE_KEY on the server so the publishing engine can safely reset the post. Add it to the hosting environment and try again.",
    };
  }

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("posts")
    .update({
      scheduled_for: date.toISOString(),
      status: "scheduled",
      attempt_count: 0,
      next_retry_at: null,
      last_error: null,
      last_error_code: null,
      last_http_status: null,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .eq("status", post.status)
    .select("id");

  if (error) return { ok: false, error: `Could not reschedule: ${error.message}` };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "This post is being published right now and can't be rescheduled." };
  }

  if (date.getTime() <= Date.now() + 60_000) await nudgeScheduler();
  revalidateWorkspace();
  return { ok: true, message: "Post rescheduled" };
}

export async function retryPost(postId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  if (!z.string().uuid().safeParse(postId).success) return { ok: false, error: "Invalid post." };

  const supabase = await createClient();
  const workspaceId = session.workspace.id;
  const { data: post } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle<Post>();
  if (!post) return { ok: false, error: "That post could not be found." };
  if (post.status !== "failed" && post.status !== "cancelled") {
    return { ok: false, error: "Only failed or cancelled posts can be retried." };
  }
  if (!post.social_account_id) {
    return { ok: false, error: "Reconnect the account before retrying this post." };
  }
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      error:
        "Retrying needs SUPABASE_SERVICE_ROLE_KEY on the server so the publishing engine can safely reset the post. Add it to the hosting environment and try again.",
    };
  }

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("posts")
    .update({
      status: "scheduled",
      scheduled_for: new Date().toISOString(),
      attempt_count: 0,
      next_retry_at: null,
      last_error: null,
      last_error_code: null,
      last_http_status: null,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .in("status", ["failed", "cancelled"])
    .select("id");

  if (error) return { ok: false, error: `Could not retry: ${error.message}` };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "This post changed while you were retrying it. Refresh and try again." };
  }
  await nudgeScheduler();
  revalidateWorkspace();
  return { ok: true, message: "Retry queued — the publisher will pick it up shortly." };
}

export async function cancelPost(postId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("posts")
    .update({ status: "cancelled" })
    .eq("id", postId)
    .eq("workspace_id", session.workspace.id)
    .in("status", ["draft", "scheduled", "failed"])
    .select("id");
  if (error) return { ok: false, error: `Could not cancel: ${error.message}` };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "This post is already publishing or published, so it can't be cancelled." };
  }
  revalidateWorkspace();
  return { ok: true, message: "Post cancelled" };
}

export async function deletePost(postId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const supabase = await createClient();
  const { data: media } = await supabase
    .from("post_media")
    .select("storage_path")
    .eq("post_id", postId)
    .eq("workspace_id", session.workspace.id)
    .maybeSingle();

  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("workspace_id", session.workspace.id);

  if (error) return { ok: false, error: `Could not delete: ${error.message}` };
  if (media?.storage_path) await removeStorageObject(supabase, media.storage_path);
  revalidateWorkspace();
  return { ok: true, message: "Post deleted" };
}

export async function duplicatePost(postId: string): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const supabase = await createClient();
  const workspaceId = session.workspace.id;
  const { data: source } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle<Post>();
  if (!source) return { ok: false, error: "That post could not be found." };

  const { data: media } = await supabase
    .from("post_media")
    .select("storage_path, mime_type, alt_text")
    .eq("post_id", source.id)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("posts")
    .insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      content: source.content,
      target_type: source.target_type,
      social_account_id: source.social_account_id,
      social_page_id: source.social_page_id,
      scheduled_for: null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: `Could not duplicate: ${error?.message ?? ""}` };

  if (media?.storage_path) {
    const extension = extForMime(media.mime_type);
    const newPath = `${session.user.id}/${crypto.randomUUID()}.${extension}`;
    const { data: file, error: downloadError } = await supabase.storage
      .from("post-media")
      .download(media.storage_path);
    if (downloadError || !file) {
      await supabase.from("posts").delete().eq("id", created.id).eq("workspace_id", workspaceId);
      return { ok: false, error: "Could not copy the attached image. Try duplicating without it." };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from("post-media").upload(newPath, bytes, {
      contentType: media.mime_type,
      upsert: false,
    });
    if (uploadError) {
      await supabase.from("posts").delete().eq("id", created.id).eq("workspace_id", workspaceId);
      return { ok: false, error: `Could not copy the attached image: ${uploadError.message}` };
    }
    const { error: mediaInsertError } = await supabase.from("post_media").insert({
      workspace_id: workspaceId,
      post_id: created.id,
      user_id: session.user.id,
      storage_path: newPath,
      mime_type: media.mime_type,
      alt_text: media.alt_text,
    });
    if (mediaInsertError) {
      await supabase.storage.from("post-media").remove([newPath]);
      await supabase.from("posts").delete().eq("id", created.id).eq("workspace_id", workspaceId);
      return { ok: false, error: `Could not copy the attached image: ${mediaInsertError.message}` };
    }
  }

  revalidateWorkspace();
  return { ok: true, data: { id: created.id }, message: "Duplicated as a draft" };
}
