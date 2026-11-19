"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/session";
import { settingsSchema } from "@/lib/validation";
import { normalizeTime } from "@/lib/scheduling/timezone";
import type { ActionResult } from "@/lib/types";

const DEMO_ERROR =
  "This is a read-only demo workspace. Connect Supabase and sign in to save changes.";

export async function updateSettings(input: {
  fullName: string;
  headline: string;
  timezone: string;
  defaultPostingTime: string;
  defaultPostingDays: number[];
  theme: "light" | "dark" | "system";
  queuePaused?: boolean;
}): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return { ok: false, error: "Please check the settings below.", fieldErrors };
  }
  const data = parsed.data;
  const time = normalizeTime(data.defaultPostingTime) ?? "10:00";
  const days = Array.from(new Set(data.defaultPostingDays)).sort((a, b) => a - b);

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: data.fullName,
      headline: data.headline || null,
      timezone: data.timezone,
      default_posting_time: `${time}:00`,
      default_posting_days: days,
      theme: data.theme,
    })
    .eq("id", session.user.id);

  if (error) return { ok: false, error: `Could not save settings: ${error.message}` };

  const { error: queueError } = await supabase.from("queue_settings").upsert(
    {
      workspace_id: session.workspace.id,
      user_id: session.user.id,
      timezone: data.timezone,
      posting_days: days,
      posting_times: [`${time}:00`],
      is_paused: data.queuePaused ?? false,
    },
    { onConflict: "workspace_id" },
  );

  if (queueError) {
    return { ok: false, error: `Profile saved, but queue settings failed: ${queueError.message}` };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/queue");
  revalidatePath("/planner");
  return { ok: true, message: "Settings saved" };
}

export async function setThemePreference(
  theme: "light" | "dark" | "system",
): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ theme })
    .eq("id", session.user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function completeOnboarding(): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  const supabase = await createClient();
  await supabase.from("profiles").update({ onboarded: true }).eq("id", session.user.id);
  revalidatePath("/dashboard");
  return { ok: true };
}
