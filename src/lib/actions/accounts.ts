"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { requireSession } from "@/lib/session";
import type { ActionResult } from "@/lib/types";

const DEMO_ERROR =
  "This is a read-only demo workspace. Connect Supabase and sign in to manage accounts.";

export async function disconnectAccount(accountId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.demo) return { ok: false, error: DEMO_ERROR };

  const supabase = await createClient();
  const { data: account } = await supabase
    .from("social_accounts")
    .select("id, display_name")
    .eq("id", accountId)
    .eq("workspace_id", session.workspace.id)
    .maybeSingle();

  if (!account) return { ok: false, error: "That social account could not be found." };
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      error:
        "Disconnecting needs SUPABASE_SERVICE_ROLE_KEY on the server so stored tokens can be deleted from Vault. Add it to the hosting environment and try again.",
    };
  }

  const admin = createAdminClient();

  // Remove tokens from Vault first. If this fails we keep the account so the
  // user can retry rather than leaving orphaned credentials behind.
  const { error: tokenError } = await admin.rpc("delete_social_tokens", {
    p_account_id: accountId,
  });
  if (tokenError) {
    return {
      ok: false,
      error: `Could not remove stored credentials: ${tokenError.message}`,
    };
  }

  const { error } = await admin
    .from("social_accounts")
    .delete()
    .eq("id", accountId)
    .eq("workspace_id", session.workspace.id)
    .select("id");

  if (error) {
    // Tokens are already gone, so never leave the account looking connected.
    await admin
      .from("social_accounts")
      .update({
        status: "needs_reconnect",
        last_error: "Disconnect did not finish. Reconnect this account to restore publishing.",
      })
      .eq("id", accountId)
      .eq("workspace_id", session.workspace.id);
    return { ok: false, error: `Could not disconnect: ${error.message}` };
  }

  revalidatePath("/accounts");
  revalidatePath("/settings");
  revalidatePath("/composer");
  revalidatePath("/queue");
  return {
    ok: true,
    message: `${account.display_name} disconnected. Scheduled posts are paused until you reconnect a target.`,
  };
}
