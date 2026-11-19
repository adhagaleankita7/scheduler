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
        "id, workspace_id, user_id, provider, provider_account_id, display_name, avatar_url, email, scopes, status, token_expires_at, refresh_token_expires_at, last_refreshed_at, last_error, connected_at, created_at, updated_at",
      )
      .eq("workspace_id", session.workspace.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("social_pages")
      .select(
        "id, workspace_id, user_id, social_account_id, provider, provider_page_id, name, vanity_name, logo_url, page_type, role, can_publish, status, created_at, updated_at",
      )
      .eq("workspace_id", session.workspace.id)
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
    // Meta's Graph API cannot publish to personal profiles, so a Facebook
    // account only exposes its Pages. LinkedIn keeps the member target.
    if (account.provider === "linkedin") {
      const memberScope = hasScope(account.scopes, LINKEDIN_MEMBER_SCOPE);
      targets.push({
        value: encodeTarget(account.id),
        accountId: account.id,
        pageId: null,
        targetType: "member",
        platform: "linkedin",
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
    }

    for (const page of pages.filter((item) => item.social_account_id === account.id)) {
      const isFacebook = account.provider === "facebook";
      const orgScope = hasOrganizationPublishScope(account.scopes);
      const adminScope = hasOrganizationAdminScope(account.scopes);
      const ready = isFacebook
        ? account.status === "connected" && page.can_publish
        : account.status === "connected" &&
          Boolean(orgScope) &&
          Boolean(adminScope) &&
          page.can_publish;

      targets.push({
        value: encodeTarget(account.id, page.id),
        accountId: account.id,
        pageId: page.id,
        targetType: "organization",
        platform: account.provider,
        label: page.name,
        subtitle: isFacebook
          ? "Facebook Page"
          : `Company page${page.role ? ` · ${formatRole(page.role)}` : ""}`,
        avatarUrl: page.logo_url,
        canPublish: ready,
        disabledReason:
          account.status !== "connected"
            ? `Reconnect this ${isFacebook ? "Facebook" : "LinkedIn"} account.`
            : isFacebook
              ? "You need a Facebook Page role that can create content."
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
  return post.account?.display_name ?? "Publishing profile";
}

/** Validate that a target belongs to the active workspace before writing. */
export async function resolveTarget(
  workspaceId: string,
  accountId: string,
  pageId: string | null,
) {
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("social_accounts")
    .select("id, workspace_id, user_id, provider, provider_account_id, scopes, status, display_name")
    .eq("id", accountId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!account) {
    return { ok: false as const, error: "That social account is not connected to your workspace." };
  }
  if (account.status !== "connected") {
    return {
      ok: false as const,
      error: "Reconnect this account before scheduling new posts.",
    };
  }

  // Facebook: only Pages can be published to. Personal profiles are not
  // supported by the Graph API, so a page is always required.
  if (account.provider === "facebook") {
    if (!pageId) {
      return {
        ok: false as const,
        error: "Choose a Facebook Page. Facebook personal profiles cannot be posted to automatically.",
      };
    }

    const { data: page } = await supabase
      .from("social_pages")
      .select("id, workspace_id, user_id, social_account_id, provider_page_id, name, can_publish")
      .eq("id", pageId)
      .eq("workspace_id", workspaceId)
      .eq("social_account_id", accountId)
      .eq("provider", "facebook")
      .maybeSingle();

    if (!page) {
      return { ok: false as const, error: "That Facebook Page is not connected to your workspace." };
    }
    if (!page.can_publish) {
      return {
        ok: false as const,
        error:
          "Your Facebook user needs a Page role that can create content (CREATE_CONTENT) before LINKFLOW can publish to it.",
      };
    }

    return {
      ok: true as const,
      targetType: "organization" as const,
      account,
      page,
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
    .select("id, workspace_id, user_id, social_account_id, provider_page_id, name, can_publish")
    .eq("id", pageId)
    .eq("workspace_id", workspaceId)
    .eq("social_account_id", accountId)
    .eq("provider", "linkedin")
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
