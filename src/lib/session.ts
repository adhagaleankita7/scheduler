import { cache } from "react";
import { redirect } from "next/navigation";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { demoProfile } from "@/lib/demo/fixtures";
import type { Profile } from "@/lib/types";

export type SessionContext = {
  user: { id: string; email: string | null };
  profile: Profile;
  demo: boolean;
};

const PROFILE_COLUMNS =
  "id, full_name, headline, avatar_url, timezone, default_posting_time, default_posting_days, theme, onboarded, created_at, updated_at";

function metadataString(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function fallbackProfile(
  userId: string,
  fullName: string | null,
  avatarUrl: string | null,
): Profile {
  return {
    id: userId,
    full_name: fullName,
    headline: null,
    avatar_url: avatarUrl,
    timezone: "Asia/Kolkata",
    default_posting_time: "10:00:00",
    default_posting_days: [1, 2, 3, 4, 5, 6, 7],
    theme: "system",
    onboarded: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  if (isDemoMode()) {
    return {
      user: { id: "d0000000-0000-4000-8000-000000000001", email: "demo@linkflow.local" },
      profile: demoProfile(),
      demo: true,
    };
  }
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  // Google sends `avatar_url` and `picture`; other providers vary.
  const metadataAvatar = metadataString(metadata, ["avatar_url", "picture"]);

  if (profile) {
    if (!profile.avatar_url && metadataAvatar) {
      // Backfill avatars for accounts created before the provider metadata was
      // captured by the sign-up trigger.
      const { data: updated } = await supabase
        .from("profiles")
        .update({ avatar_url: metadataAvatar })
        .eq("id", user.id)
        .select(PROFILE_COLUMNS)
        .maybeSingle();

      if (updated) {
        return {
          user: { id: user.id, email: user.email ?? null },
          profile: updated as Profile,
          demo: false,
        };
      }
    }

    return {
      user: { id: user.id, email: user.email ?? null },
      profile: profile as Profile,
      demo: false,
    };
  }

  // The database trigger normally creates this row. Self-heal older accounts
  // and OAuth sign-ups that raced the trigger.
  const fullName =
    metadataString(metadata, ["full_name", "name"]) ??
    user.email?.split("@")[0] ??
    null;
  const { data: created } = await supabase
    .from("profiles")
    .insert({ id: user.id, full_name: fullName, avatar_url: metadataAvatar })
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  return {
    user: { id: user.id, email: user.email ?? null },
    profile: (created as Profile | null) ?? fallbackProfile(user.id, fullName, metadataAvatar),
    demo: false,
  };
});

export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect("/login?reason=session");
  return session;
}
