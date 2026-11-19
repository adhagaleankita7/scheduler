import { cache } from "react";
import { redirect } from "next/navigation";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { demoProfile } from "@/lib/demo/fixtures";
import type { Profile, Workspace, WorkspaceRole } from "@/lib/types";

export const DEMO_WORKSPACE_ID = "d0000000-0000-4000-8000-000000000101";

export type SessionContext = {
  user: { id: string; email: string | null };
  profile: Profile;
  workspace: Workspace;
  workspaces: Workspace[];
  demo: boolean;
};

const PROFILE_COLUMNS =
  "id, email, full_name, headline, avatar_url, timezone, default_posting_time, default_posting_days, theme, onboarded, active_workspace_id, created_at, updated_at";

type MembershipRow = {
  role: WorkspaceRole;
  workspace:
    | {
        id: string;
        name: string;
        owner_id: string;
        created_at: string;
      }
    | null;
};

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
  email: string | null,
  fullName: string | null,
  avatarUrl: string | null,
): Profile {
  return {
    id: userId,
    email,
    full_name: fullName,
    headline: null,
    avatar_url: avatarUrl,
    timezone: "Asia/Kolkata",
    default_posting_time: "10:00:00",
    default_posting_days: [1, 2, 3, 4, 5, 6, 7],
    theme: "system",
    onboarded: false,
    active_workspace_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function loadWorkspaces(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Workspace[]> {
  const { data } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces!inner(id, name, owner_id, created_at)")
    .eq("user_id", userId);

  return ((data ?? []) as unknown as MembershipRow[])
    .filter((row): row is MembershipRow & { workspace: NonNullable<MembershipRow["workspace"]> } =>
      Boolean(row.workspace),
    )
    .map((row) => ({
      id: row.workspace.id,
      name: row.workspace.name,
      owner_id: row.workspace.owner_id,
      role: row.role,
      created_at: row.workspace.created_at,
    }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0;
      return a.name.localeCompare(b.name);
    });
}

export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  if (isDemoMode()) {
    const user = { id: "d0000000-0000-4000-8000-000000000001", email: "demo@linkflow.local" };
    const workspace: Workspace = {
      id: DEMO_WORKSPACE_ID,
      name: "Demo workspace",
      owner_id: user.id,
      role: "owner",
    };
    return {
      user,
      profile: demoProfile(),
      workspace,
      workspaces: [workspace],
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

  const { data: profileRow } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  // Google sends `avatar_url` and `picture`; other providers vary.
  const metadataAvatar = metadataString(metadata, ["avatar_url", "picture"]);

  let profile = profileRow as Profile | null;

  if (profile && !profile.avatar_url && metadataAvatar) {
    // Backfill avatars for accounts created before the provider metadata was
    // captured by the sign-up trigger.
    const { data: updated } = await supabase
      .from("profiles")
      .update({ avatar_url: metadataAvatar })
      .eq("id", user.id)
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    if (updated) profile = updated as Profile;
  }

  if (!profile) {
    // The database trigger normally creates this row. Self-heal older accounts
    // and OAuth sign-ups that raced the trigger.
    const fullName =
      metadataString(metadata, ["full_name", "name"]) ??
      user.email?.split("@")[0] ??
      null;
    const { data: created } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? null,
        full_name: fullName,
        avatar_url: metadataAvatar,
      })
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    profile =
      (created as Profile | null) ??
      fallbackProfile(user.id, user.email ?? null, fullName, metadataAvatar);
  }

  if (!profile) return null;

  // Existing users who were invited by email are added the next time they load
  // the app. New signups are handled by the auth trigger.
  if (user.email) {
    await supabase.rpc("accept_workspace_invites");
  }

  let workspaces = await loadWorkspaces(supabase, user.id);

  if (workspaces.length === 0) {
    // Legacy rows and signups that predate the workspace migration.
    await supabase.rpc("ensure_personal_workspace");
    workspaces = await loadWorkspaces(supabase, user.id);
  }

  if (workspaces.length === 0) {
    return null;
  }

  const activeWorkspaceId = profile.active_workspace_id;
  const active =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces.find((workspace) => workspace.role === "owner") ??
    workspaces[0];

  if (activeWorkspaceId !== active.id) {
    await supabase
      .from("profiles")
      .update({ active_workspace_id: active.id })
      .eq("id", user.id);
    profile = { ...profile, active_workspace_id: active.id };
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    profile,
    workspace: active,
    workspaces,
    demo: false,
  };
});

export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect("/login?reason=session");
  return session;
}
