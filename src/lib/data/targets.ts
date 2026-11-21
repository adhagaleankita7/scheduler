import { getAccountsOverview } from "@/lib/data/accounts";
import { demoPosts } from "@/lib/demo/fixtures";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  summarizeTargets,
  type TargetPostRow,
  type TargetSummary,
} from "@/lib/targets";
import type { SocialAccount, SocialPage } from "@/lib/types";

export type {
  TargetPostRow,
  TargetStatusCounts,
  TargetSummary,
} from "@/lib/targets";
export { emptyStatusCounts, summarizeTargets } from "@/lib/targets";

export type TargetAnalytics = {
  /** Members first, then pages, in the order the composer lists them. */
  targets: TargetSummary[];
  accounts: SocialAccount[];
  pages: SocialPage[];
  demo: boolean;
};

/** One query for every target in the workspace, aggregated in memory. */
export async function getTargetAnalytics(): Promise<TargetAnalytics> {
  const [session, overview] = await Promise.all([requireSession(), getAccountsOverview()]);

  if (overview.demo) {
    return {
      targets: summarizeTargets(overview.targets, demoPosts()),
      accounts: overview.accounts,
      pages: overview.pages,
      demo: true,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "social_account_id, social_page_id, status, like_count, comment_count, share_count, published_at",
    )
    .eq("workspace_id", session.workspace.id);

  if (error) {
    throw new Error(`Could not load page analytics: ${error.message}`);
  }

  return {
    targets: summarizeTargets(overview.targets, (data ?? []) as TargetPostRow[]),
    accounts: overview.accounts,
    pages: overview.pages,
    demo: false,
  };
}

/** A single page (Facebook Page or LinkedIn company page) with its numbers. */
export async function getPageSummary(pageId: string) {
  const { targets, accounts, pages, demo } = await getTargetAnalytics();
  const page = pages.find((item) => item.id === pageId);
  if (!page) return null;

  const summary = targets.find((target) => target.pageId === pageId);
  if (!summary) return null;

  const account = accounts.find((item) => item.id === page.social_account_id) ?? null;
  return { page, account, summary, demo };
}
