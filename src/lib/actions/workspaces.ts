"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { requireSession } from "@/lib/session";
import type { ActionResult } from "@/lib/types";

const DEMO_ERROR =
  "This is a read-only demo workspace. Connect Supabase and sign in to manage the workspace.";

const roleSchema = z.enum(["editor", "viewer"]);

function revalidateWorkspaceScope() {
  revalidatePath("/", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/accounts");
  revalidatePath("/posts");
  revalidatePath("/queue");
  revalidatePath("/calendar");
  revalidatePath("/planner");
  revalidatePath("/planner/month");
  revalidatePath("/analytics");
  revalidatePath("/settings");
}

export async function switchWorkspace(workspaceId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  if (!z.string().uuid().safeParse(workspaceId).success) {
    return { ok: false, error: "Invalid workspace." };
  }
  if (!session.workspaces.some((workspace) => workspace.id === workspaceId)) {
    return { ok: false, error: "You do not have access to that workspace." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ active_workspace_id: workspaceId })
    .eq("id", session.user.id);

  if (error) return { ok: false, error: `Could not switch workspace: ${error.message}` };

  revalidateWorkspaceScope();
  return { ok: true, message: "Workspace switched" };
}

export async function inviteWorkspaceMember(input: {
  email: string;
  role: "editor" | "viewer";
}): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  if (session.workspace.role !== "owner") {
    return { ok: false, error: "Only the workspace owner can invite people." };
  }

  const parsed = z
    .object({ email: z.string().trim().email("Enter a valid email address."), role: roleSchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the invite details." };
  }

  const email = parsed.data.email.toLowerCase();
  if (email === session.user.email?.toLowerCase()) {
    return { ok: false, error: "You are already the owner of this workspace." };
  }

  const supabase = await createClient();
  const workspaceId = session.workspace.id;

  // Existing users are added immediately. Looking them up by email needs the
  // service role because profiles are only visible to people who already share
  // a workspace. Without it we fall back to a pending invite.
  let existingUserId: string | null = null;
  if (isServiceRoleConfigured()) {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle<{ id: string }>();
    existingUserId = profile?.id ?? null;
  }

  if (existingUserId) {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", existingUserId)
      .maybeSingle();
    if (member) return { ok: false, error: "That person is already a member of this workspace." };

    const { error } = await supabase.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: existingUserId,
      role: parsed.data.role,
    });
    if (error) return { ok: false, error: `Could not add that person: ${error.message}` };

    revalidateWorkspaceScope();
    return { ok: true, message: "Member added. They can switch to this workspace right away." };
  }

  const { error } = await supabase.from("workspace_invites").insert({
    workspace_id: workspaceId,
    email,
    role: parsed.data.role,
    invited_by: session.user.id,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "An invite for that email is already pending." };
    }
    return { ok: false, error: `Could not create the invite: ${error.message}` };
  }

  revalidateWorkspaceScope();
  return {
    ok: true,
    message: "Invite saved. They will join automatically after signing up with this email.",
  };
}

export async function updateWorkspaceMemberRole(input: {
  userId: string;
  role: "editor" | "viewer";
}): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  if (session.workspace.role !== "owner") {
    return { ok: false, error: "Only the workspace owner can change roles." };
  }

  const parsed = z.object({ userId: z.string().uuid(), role: roleSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid role." };
  if (parsed.data.userId === session.workspace.owner_id) {
    return { ok: false, error: "The workspace owner's role cannot be changed." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspace_members")
    .update({ role: parsed.data.role })
    .eq("workspace_id", session.workspace.id)
    .eq("user_id", parsed.data.userId);

  if (error) return { ok: false, error: `Could not update the role: ${error.message}` };

  revalidateWorkspaceScope();
  return { ok: true, message: "Role updated" };
}

export async function removeWorkspaceMember(userId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  if (session.workspace.role !== "owner") {
    return { ok: false, error: "Only the workspace owner can remove members." };
  }

  const parsed = z.string().uuid().safeParse(userId);
  if (!parsed.success) return { ok: false, error: "Invalid member." };
  if (parsed.data === session.workspace.owner_id) {
    return { ok: false, error: "The workspace owner cannot be removed." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", session.workspace.id)
    .eq("user_id", parsed.data);

  if (error) return { ok: false, error: `Could not remove that member: ${error.message}` };

  revalidateWorkspaceScope();
  return { ok: true, message: "Member removed" };
}

export async function cancelWorkspaceInvite(inviteId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };
  if (session.workspace.role !== "owner") {
    return { ok: false, error: "Only the workspace owner can cancel invites." };
  }

  const parsed = z.string().uuid().safeParse(inviteId);
  if (!parsed.success) return { ok: false, error: "Invalid invite." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspace_invites")
    .delete()
    .eq("id", parsed.data)
    .eq("workspace_id", session.workspace.id);

  if (error) return { ok: false, error: `Could not cancel that invite: ${error.message}` };

  revalidateWorkspaceScope();
  return { ok: true, message: "Invite cancelled" };
}
