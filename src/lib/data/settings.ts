import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { demoQueueSettings } from "@/lib/demo/fixtures";
import { getAccountsOverview } from "@/lib/data/accounts";
import { getWorkspaceMembers } from "@/lib/data/workspaces";
import type { QueueSettings, WorkspaceInvite, WorkspaceMember } from "@/lib/types";

export async function getSettingsData() {
  const session = await requireSession();
  const overview = await getAccountsOverview();

  if (session.demo) {
    const members: WorkspaceMember[] = [
      {
        user_id: session.user.id,
        role: "owner",
        joined_at: session.profile.created_at,
        full_name: session.profile.full_name,
        email: session.user.email,
        avatar_url: session.profile.avatar_url,
      },
    ];
    const invites: WorkspaceInvite[] = [];
    return {
      profile: session.profile,
      queue: demoQueueSettings(),
      accounts: overview.accounts,
      pages: overview.pages,
      workspace: session.workspace,
      workspaces: session.workspaces,
      members,
      invites,
      demo: true,
    };
  }

  const { members, invites } = await getWorkspaceMembers(session.workspace.id);

  const supabase = await createClient();
  const { data: queue } = await supabase
    .from("queue_settings")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .maybeSingle();

  return {
    profile: session.profile,
    queue:
      (queue as QueueSettings | null) ??
      ({
        workspace_id: session.workspace.id,
        user_id: session.user.id,
        timezone: session.profile.timezone,
        posting_days: session.profile.default_posting_days,
        posting_times: [session.profile.default_posting_time],
        is_paused: false,
        last_assigned_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } satisfies QueueSettings),
    accounts: overview.accounts,
    pages: overview.pages,
    workspace: session.workspace,
    workspaces: session.workspaces,
    members,
    invites,
    demo: false,
  };
}
