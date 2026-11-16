import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { demoAccounts } from "@/lib/demo/fixtures";
import {
  hasOrganizationAdminScope,
  hasOrganizationPublishScope,
  hasScope,
  LINKEDIN_MEMBER_SCOPE,
} from "@/lib/linkedin/scopes";
import { encodeTarget } from "@/lib/validation";
import type { PublishTargetOption, SocialAccount, SocialPage } from "@/lib/types";

export type AccountsOverview = {
  accounts: SocialAccount[];
  pages: SocialPage[];
  targets: PublishTargetOption[];
  demo: boolean;
};

export async function getAccountsOverview(): Promise<AccountsOverview> {
  const session = await requireSession();

  if (session.demo) {
    const { accounts, pages } = demoAccounts();
    return {
      accounts,
      pages,
      targets: buildTargets(accounts, pages),
      demo: true,
    };
  }

  const supabase = await createClient();
  const [accountsResult, pagesResult] = await Promise.all([
    supabase
      .from("social_accounts")
      .select(
        "id, user_id, provider, provider_account_id, display_name, avatar_url, email, scopes, status, token_expires_at, refresh_token_expires_at, last_refreshed_at, last_error, connected_at, created_at, updated_at",
      )
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("social_pages")
      .select(
        "id, user_id, social_account_id, provider_page_id, name, vanity_name, logo_url, page_type, role, can_publish, status, created_at, updated_at",
      )
      .eq("user_id", session.user.id)
      .order("name", { ascending: true }),
  ]);

  const accounts = (accountsResult.data ?? []) as SocialAccount[];
  const pages = (pagesResult.data ?? []) as SocialPage[];

  return {
    accounts,
    pages,
    targets: buildTargets(accounts, pages),
    demo: false,
  };
}

export function buildTargets(
  accounts: SocialAccount[],
  pages: SocialPage[],
): PublishTargetOption[] {
  const targets: PublishTargetOption[] = [];

  for (const account of accounts) {
    const memberScope = hasScope(account.scopes, LINKEDIN_MEMBER_SCOPE);
    targets.push({
      value: encodeTarget(account.id),
      accountId: account.id,
      pageId: null,
      targetType: "member",
      label: account.display_name,
      subtitle: "Personal profile",
      avatarUrl: account.avatar_url,
      canPublish: account.status === "connected" && Boolean(memberScope),
      disabledReason:
        account.status !== "connected"
          ? "Reconnect this LinkedIn account."
          : !memberScope
            ? "Missing w_member_social permission."
            : undefined,
    });

    for (const page of pages.filter((item) => item.social_account_id === account.id)) {
      const orgScope = hasOrganizationPublishScope(account.scopes);
      const adminScope = hasOrganizationAdminScope(account.scopes);
      targets.push({
        value: encodeTarget(account.id, page.id),
        accountId: account.id,
        pageId: page.id,
        targetType: "organization",
        label: page.name,
        subtitle: `Company page${page.role ? ` · ${formatRole(page.role)}` : ""}`,
        avatarUrl: page.logo_url,
        canPublish:
          account.status === "connected" &&
          Boolean(orgScope) &&
          Boolean(adminScope) &&
          page.can_publish,
        disabledReason:
          account.status !== "connected"
            ? "Reconnect this LinkedIn account."
            : !orgScope
              ? "LinkedIn has not granted w_organization_social."
              : !adminScope
                ? "LinkedIn has not granted r_organization_admin."
                : !page.can_publish
                  ? "Your LinkedIn member needs a Super Admin or Content Admin role on this page."
                  : undefined,
      });
    }
  }

  return targets;
}

function formatRole(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function targetLabel(
  post: { target_type: string; account?: { display_name: string } | null; page?: { name: string } | null },
) {
  if (post.target_type === "organization" && post.page) return post.page.name;
  return post.account?.display_name ?? "LinkedIn profile";
}

/** Validate that a target belongs to the signed-in user before writing. */
export async function resolveTarget(
  userId: string,
  accountId: string,
  pageId: string | null,
) {
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("social_accounts")
    .select("id, user_id, provider_account_id, scopes, status, display_name")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!account) {
    return { ok: false as const, error: "That LinkedIn account is not connected to your workspace." };
  }
  if (account.status !== "connected") {
    return {
      ok: false as const,
      error: "Reconnect your LinkedIn account before scheduling new posts.",
    };
  }

  if (!pageId) {
    if (!hasScope(account.scopes, LINKEDIN_MEMBER_SCOPE)) {
      return {
        ok: false as const,
        error: "This LinkedIn account is missing the w_member_social permission.",
      };
    }
    return {
      ok: true as const,
      targetType: "member" as const,
      account,
      page: null,
    };
  }

  const { data: page } = await supabase
    .from("social_pages")
    .select("id, user_id, social_account_id, provider_page_id, name, can_publish")
    .eq("id", pageId)
    .eq("user_id", userId)
    .eq("social_account_id", accountId)
    .maybeSingle();

  if (!page) {
    return { ok: false as const, error: "That company page is not connected to your workspace." };
  }
  if (!hasOrganizationPublishScope(account.scopes)) {
    return {
      ok: false as const,
      error: "LinkedIn has not granted w_organization_social for this account.",
    };
  }
  if (!hasOrganizationAdminScope(account.scopes)) {
    return {
      ok: false as const,
      error: "LinkedIn has not granted organization admin access for this account.",
    };
  }
  if (!page.can_publish) {
    return {
      ok: false as const,
      error:
        "Your LinkedIn member needs a Super Admin or Content Admin role on this company page before LINKFLOW can publish to it.",
    };
  }

  return {
    ok: true as const,
    targetType: "organization" as const,
    account,
    page,
  };
}
