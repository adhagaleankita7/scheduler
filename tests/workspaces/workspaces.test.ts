import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the shared-workspace migration. These pieces cannot run in
 * Vitest (they are SQL and an Edge Function), so the tests pin the contract
 * that keeps collaborators seeing the same data as the owner.
 */

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

const migration = read("supabase/migrations/20261119000100_workspaces.sql");
const queueActions = read("src/lib/actions/queue.ts");
const postActions = read("src/lib/actions/posts.ts");
const settingsData = read("src/lib/data/settings.ts");
const edgeFunction = read("supabase/functions/publish-scheduled-posts/index.ts");
const session = read("src/lib/session.ts");

describe("workspace migration", () => {
  it("creates workspace tables and role helpers", () => {
    expect(migration).toContain("create table if not exists public.workspaces");
    expect(migration).toContain("create table if not exists public.workspace_members");
    expect(migration).toContain("create table if not exists public.workspace_invites");
    for (const helper of [
      "is_workspace_member",
      "can_edit_workspace",
      "is_workspace_owner",
      "shares_workspace_with",
    ]) {
      expect(migration).toContain(`function public.${helper}`);
    }
  });

  it("moves every content table onto workspace_id", () => {
    for (const table of [
      "social_accounts",
      "social_pages",
      "publishing_schedules",
      "posts",
      "post_media",
      "queue_settings",
    ]) {
      expect(migration).toContain(`alter table public.${table}`);
      expect(migration).toContain("workspace_id");
    }
    expect(migration).toContain("primary key (workspace_id)");
    expect(migration).toContain("on public.social_accounts (workspace_id, provider, provider_account_id)");
    expect(migration).toContain("on public.social_pages (workspace_id, provider, provider_page_id)");
  });

  it("pauses and claims the queue per workspace, not per user", () => {
    expect(migration).toContain("where qs.workspace_id = p.workspace_id and qs.is_paused = true");
    expect(migration).not.toContain("where qs.user_id = p.user_id");
  });

  it("lets teammates read each other's media but only upload to their own folder", () => {
    expect(migration).toContain("public.can_access_media_path");
    expect(migration).toContain("public.shares_workspace_with(owner_user)");
    expect(migration).toContain("(storage.foldername(name))[1] = (select auth.uid())::text");
  });

  it("grants the new workspace column on the column-locked accounts table", () => {
    // social_accounts only grants column-level SELECT (tokens live in Vault),
    // so a missing column grant breaks every account query at runtime.
    expect(migration).toContain("grant select (workspace_id) on public.social_accounts to authenticated;");
  });

  it("auto-accepts invites for existing and new users", () => {
    expect(migration).toContain("function public.handle_new_user");
    expect(migration).toContain("where lower(email) = lower(coalesce(new.email, ''))");
    expect(migration).toContain("function public.accept_workspace_invites");
  });
});

describe("application workspace scoping", () => {
  it("loads the active workspace and memberships for every session", () => {
    expect(session).toContain("workspace: Workspace");
    expect(session).toContain("workspaces: Workspace[]");
    expect(session).toContain('from("workspace_members")');
    expect(session).toContain('rpc("ensure_personal_workspace")');
    expect(session).toContain('rpc("accept_workspace_invites")');
  });

  it("scopes queue settings by workspace and upserts on the new primary key", () => {
    expect(queueActions).toContain('onConflict: "workspace_id"');
    expect(settingsData).toContain('.eq("workspace_id", session.workspace.id)');
    expect(settingsData).toContain("workspace_id: session.workspace.id");
  });

  it("writes workspace_id on posts, schedules and media", () => {
    for (const table of ["posts", "publishing_schedules", "post_media"]) {
      expect(postActions).toContain(`from("${table}")`);
    }
    expect(postActions).toContain("workspace_id: workspaceId");
    expect(postActions).toContain("resolveTarget(session.workspace.id");
  });
});

describe("publishing worker collaborator safety", () => {
  it("spends the account owner's token, not the post author's", () => {
    expect(edgeFunction).toContain("tokens.user_id !== accountRow.user_id");
    expect(edgeFunction).toContain("accountRow.workspace_id !== post.workspace_id");
  });

  it("verifies pages within the post's workspace", () => {
    expect(edgeFunction).toContain('.eq("workspace_id", post.workspace_id)');
    expect(edgeFunction).not.toContain('.eq("user_id", post.user_id)');
  });

  it("records the workspace on every publishing log", () => {
    expect(edgeFunction).toContain("workspace_id: entry.post.workspace_id");
  });
});
