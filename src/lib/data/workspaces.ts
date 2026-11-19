import { createClient } from "@/lib/supabase/server";
import type { WorkspaceInvite, WorkspaceMember, WorkspaceRole } from "@/lib/types";

type MemberRow = {
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

/**
 * Members and pending invites for a workspace. Invites are only readable by the
 * owner (RLS), so non-owners simply get an empty list.
 */
export async function getWorkspaceMembers(workspaceId: string) {
  const supabase = await createClient();

  const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, role, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("workspace_invites")
      .select("id, email, role, created_at, expires_at")
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  const rows = (memberRows ?? []) as MemberRow[];
  const userIds = rows.map((row) => row.user_id);

  const { data: profileRows } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", userIds)
    : { data: [] as ProfileRow[] };

  const profileMap = new Map(
    ((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );

  const members: WorkspaceMember[] = rows.map((row) => {
    const profile = profileMap.get(row.user_id);
    return {
      user_id: row.user_id,
      role: row.role,
      joined_at: row.created_at,
      full_name: profile?.full_name ?? null,
      email: profile?.email ?? null,
      avatar_url: profile?.avatar_url ?? null,
    };
  });

  const invites: WorkspaceInvite[] = ((inviteRows ?? []) as Array<{
    id: string;
    email: string;
    role: WorkspaceInvite["role"];
    created_at: string;
    expires_at: string;
  }>).map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    created_at: invite.created_at,
    expires_at: invite.expires_at,
  }));

  return { members, invites };
}
