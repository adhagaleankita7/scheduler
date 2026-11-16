import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { demoQueueSettings } from "@/lib/demo/fixtures";
import { getAccountsOverview } from "@/lib/data/accounts";
import type { QueueSettings } from "@/lib/types";

export async function getSettingsData() {
  const session = await requireSession();
  const overview = await getAccountsOverview();

  if (session.demo) {
    return {
      profile: session.profile,
      queue: demoQueueSettings(),
      accounts: overview.accounts,
      pages: overview.pages,
      demo: true,
    };
  }

  const supabase = await createClient();
  const { data: queue } = await supabase
    .from("queue_settings")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();

  return {
    profile: session.profile,
    queue:
      (queue as QueueSettings | null) ??
      ({
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
    demo: false,
  };
}
