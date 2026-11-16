import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Linkedin,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { TargetAvatar } from "@/components/shared/target-avatar";
import { LocalTime } from "@/components/shared/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DisconnectAccountButton } from "@/components/accounts/disconnect-account-button";
import { getAccountsOverview } from "@/lib/data/accounts";
import { requireSession } from "@/lib/session";
import { isLinkedInConfigured, isLinkedInMockMode, getLinkedInScopes } from "@/lib/env";
import { getLinkedInRedirectUri } from "@/lib/linkedin/oauth";
import {
  hasOrganizationAdminScope,
  hasOrganizationPublishScope,
  splitRequestedScopes,
} from "@/lib/linkedin/scopes";
import { isMockProviderAccountId } from "@/lib/linkedin/mock-account";
import type { AccountStatus, SocialAccount, SocialPage } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

const STATUS: Record<AccountStatus, { label: string; variant: "success" | "warning" | "muted" }> = {
  connected: { label: "Connected", variant: "success" },
  needs_reconnect: { label: "Needs reconnect", variant: "warning" },
  disconnected: { label: "Disconnected", variant: "muted" },
};

const REQUIRED_SCOPES = [
  { scope: "openid", label: "Sign in with LinkedIn (OpenID)" },
  { scope: "profile", label: "Read your basic profile" },
  { scope: "email", label: "Read the email on your LinkedIn account" },
  { scope: "w_member_social", label: "Publish as your personal profile" },
  { scope: "w_organization_social", label: "Publish to company pages (optional)" },
  { scope: "r_organization_admin", label: "Verify your company page admin role (optional)" },
  { scope: "rw_organization_admin", label: "Manage company pages (optional, replaces r_organization_admin)" },
];

function formatRole(role: string | null) {
  if (!role) return "No role reported";
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ConnectButton({
  demo,
  configured,
  mock,
  size = "default",
}: {
  demo: boolean;
  configured: boolean;
  mock: boolean;
  size?: "default" | "sm";
}) {
  if (demo) {
    return (
      <Button asChild variant="outline" size={size}>
        <Link href="/setup">
          <ShieldCheck className="size-4" /> Connect Supabase first
        </Link>
      </Button>
    );
  }
  if (!configured && mock) {
    return (
      <Button asChild variant="gradient" size={size}>
        <a href="/api/linkedin/connect">
          <FlaskConical className="size-4" /> Connect mock LinkedIn
        </a>
      </Button>
    );
  }
  if (!configured) {
    return (
      <Button asChild variant="outline" size={size}>
        <Link href="/setup">
          <KeyRound className="size-4" /> Add LinkedIn credentials
        </Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="gradient" size={size}>
      <a href="/api/linkedin/connect">
        <Linkedin className="size-4" /> Connect LinkedIn
      </a>
    </Button>
  );
}

function PageRow({ page }: { page: SocialPage }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
      <TargetAvatar name={page.name} src={page.logo_url} type="organization" className="size-7" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-[12px] font-semibold">{page.name}</p>
          {page.can_publish ? (
            <Badge variant="success" className="px-1.5 py-0 text-[9px]">
              <Check className="size-2.5" /> Can publish
            </Badge>
          ) : (
            <Badge variant="warning" className="px-1.5 py-0 text-[9px]">
              <X className="size-2.5" /> Read only
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-0.5 text-[10.5px]">
          {formatRole(page.role)}
          {page.vanity_name ? ` · linkedin.com/company/${page.vanity_name}` : ""}
        </p>
        {!page.can_publish && (
          <p className="mt-1 text-[10.5px] leading-relaxed text-amber-600 dark:text-amber-400">
            Your LinkedIn member needs a Super Admin or Content Admin role on this page. Ask a page
            admin to update your role, then reconnect.
          </p>
        )}
      </div>
    </div>
  );
}

function AccountCard({
  account,
  pages,
  timezone,
  demo,
  organizationScopesConfigured,
}: {
  account: SocialAccount;
  pages: SocialPage[];
  timezone: string;
  demo: boolean;
  organizationScopesConfigured: boolean;
}) {
  const status = STATUS[account.status];
  const accountPages = pages.filter((page) => page.social_account_id === account.id);
  const scopes = new Set(account.scopes ?? []);
  const mockAccount = isMockProviderAccountId(account.provider_account_id);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <TargetAvatar name={account.display_name} src={account.avatar_url} className="size-11" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <CardTitle className="truncate">{account.display_name}</CardTitle>
              <Badge variant={status.variant}>{status.label}</Badge>
              {mockAccount && <Badge variant="outline">Mock</Badge>}
            </div>
            <CardDescription className="truncate">
              {mockAccount
                ? "Simulated account — no real LinkedIn token"
                : `${account.email ?? "LinkedIn member"} · ${accountPages.length} company page${
                    accountPages.length === 1 ? "" : "s"
                  }`}
            </CardDescription>
            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
              <span className="inline-flex items-center gap-1">
                <RefreshCw className="size-2.5" /> Connected{" "}
                <LocalTime iso={account.connected_at} timeZone={timezone} pattern="MMM d, yyyy" />
              </span>
              <span className="inline-flex items-center gap-1">
                <KeyRound className="size-2.5" /> Token expires{" "}
                <LocalTime
                  iso={account.token_expires_at}
                  timeZone={timezone}
                  pattern="MMM d, yyyy · h:mm a"
                />
              </span>
            </div>
          </div>
        </div>
        <DisconnectAccountButton
          accountId={account.id}
          accountName={account.display_name}
          disabled={demo}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {account.status !== "connected" && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {account.last_error ??
              "LinkedIn needs you to reconnect this account before it can publish again."}
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
            Granted permissions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REQUIRED_SCOPES.map((item) => {
              // r_organization_admin and rw_organization_admin are alternatives.
              const granted =
                item.scope === "r_organization_admin" || item.scope === "rw_organization_admin"
                  ? scopes.has("r_organization_admin") || scopes.has("rw_organization_admin")
                  : scopes.has(item.scope);
              return (
                <span
                  key={item.scope}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    granted
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )}
                  title={item.label}
                >
                  {granted ? <Check className="size-2.5" /> : <X className="size-2.5" />}
                  {item.scope}
                </span>
              );
            })}
          </div>
          {!scopes.has("w_organization_social") && (
            <p className="text-muted-foreground mt-1.5 text-[10.5px]">
              Personal posting still works. Company page publishing unlocks after LinkedIn approves
              the Community Management API for your app.
            </p>
          )}
          {organizationScopesConfigured &&
            !mockAccount &&
            !hasOrganizationPublishScope(account.scopes) && (
              <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">Waiting on LinkedIn approval.</span> LINKFLOW
                  asked for the company-page scopes, but this connection was granted personal
                  permissions only. Personal posting works now; once the Community Management API is
                  approved for the app, click{" "}
                  <a
                    href="/api/linkedin/connect"
                    className="font-semibold underline underline-offset-2"
                  >
                    Reconnect
                  </a>{" "}
                  to unlock page publishing — no code or env change needed.
                </span>
              </div>
            )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Building2 className="size-3 text-muted-foreground" />
            <p className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
              Company pages
            </p>
          </div>
          {accountPages.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px]">
              No company pages returned. LINKFLOW only lists pages where you are an Administrator or
              Content Admin.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {accountPages.map((page) => (
                <PageRow key={page.id} page={page} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type AccountsSearchParams = {
  error?: string;
  notice?: string;
  connected?: string;
  mock?: string;
};

/**
 * A short, honest checklist for the one workflow that always causes support
 * questions: publishing as a company page. Each row is derived from live state
 * (env scopes, granted token scopes, page ACLs) so the next action is obvious.
 */
function CompanyPageChecklist({
  organizationScopesConfigured,
  accounts,
  pages,
  hasConnectedAccount,
}: {
  organizationScopesConfigured: boolean;
  accounts: SocialAccount[];
  pages: SocialPage[];
  hasConnectedAccount: boolean;
}) {
  const orgGranted = accounts.some(
    (account) =>
      account.status === "connected" &&
      hasOrganizationPublishScope(account.scopes) &&
      hasOrganizationAdminScope(account.scopes),
  );
  const publishable = pages.filter((page) => page.can_publish).length;

  const steps = [
    {
      label: "App requests company-page scopes",
      ready: organizationScopesConfigured,
      detail: organizationScopesConfigured
        ? "LINKEDIN_SCOPES includes w_organization_social + r_organization_admin."
        : "Add both org scopes to LINKEDIN_SCOPES. Safe to do now: while approval is pending LINKFLOW falls back to personal scopes instead of failing.",
    },
    {
      label: "LinkedIn approved the app",
      ready: orgGranted,
      detail: orgGranted
        ? "The connected account carries the organization scopes."
        : "Request the Community Management API under Products in the LinkedIn developer app, then reconnect. Review can take days to weeks.",
    },
    {
      label: "Your LinkedIn member is a page admin",
      ready: pages.length > 0,
      detail:
        pages.length > 0
          ? `${pages.length} page${pages.length === 1 ? "" : "s"} visible to this account.`
          : "A page admin must add you as Super Admin or Content Admin (Page → Admin tools → Manage admins), then reconnect.",
    },
    {
      label: "Page can publish",
      ready: publishable > 0,
      detail:
        publishable > 0
          ? `${publishable} page${publishable === 1 ? "" : "s"} ready — choose it as the target in Planner or Composer.`
          : "Every visible page is read-only or still pending approval.",
    },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" /> Company page checklist
          </CardTitle>
          <CardDescription>
            Four conditions must line up before a page can publish. This updates live from your
            connection.
          </CardDescription>
        </div>
        {publishable > 0 ? (
          <Badge variant="success">Ready</Badge>
        ) : (
          <Badge variant="warning">In progress</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5"
          >
            {step.ready ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            ) : (
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-border text-[9px] font-bold text-muted-foreground">
                {index + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold">{step.label}</p>
              <p className="text-muted-foreground mt-0.5 text-[10.5px] leading-relaxed">
                {step.detail}
              </p>
            </div>
          </div>
        ))}
        {organizationScopesConfigured && !orgGranted && hasConnectedAccount && (
          <Button asChild variant="outline" size="sm" className="mt-1">
            <a href="/api/linkedin/connect">
              <RefreshCw className="size-3.5" /> Reconnect to retry the org scopes
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function OAuthResultBanner({
  error,
  notice,
  connected,
  mock,
}: AccountsSearchParams) {
  if (!error && connected !== "1" && !notice) return null;

  const message = error || notice;
  const success = !error && connected === "1";

  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[11.5px] leading-relaxed",
        success
          ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300"
          : error
            ? "border-destructive/25 bg-destructive/[0.06] text-destructive"
            : "border-blue-500/25 bg-blue-500/[0.06] text-blue-700 dark:text-blue-300",
      )}
    >
      {success ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
      ) : error ? (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="font-semibold">
          {success
            ? mock === "1"
              ? "Mock LinkedIn connected."
              : "LinkedIn connected."
            : error
              ? "LinkedIn connection failed."
              : "LinkedIn connection update."}
        </span>{" "}
        {message ??
          "Your account is connected. Reload this page if it does not appear below."}
      </span>
      <Link
        href="/accounts"
        className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline"
      >
        Dismiss
      </Link>
    </div>
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<AccountsSearchParams>;
}) {
  const [session, overview, params] = await Promise.all([
    requireSession(),
    getAccountsOverview(),
    searchParams,
  ]);
  const timezone = session.profile.timezone || "Asia/Kolkata";
  const configured = isLinkedInConfigured();
  const mock = isLinkedInMockMode();
  const requestedScopes = getLinkedInScopes().split(/\s+/).filter(Boolean);
  const requestedSplit = splitRequestedScopes(requestedScopes);
  const organizationScopesConfigured =
    hasOrganizationPublishScope(requestedSplit.organization) &&
    hasOrganizationAdminScope(requestedSplit.organization);

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Linkedin className="size-3.5" />
            Official LinkedIn API
          </>
        }
        title="LinkedIn connections and pages"
        description="Publish as yourself or an authorized company page. Tokens are stored server-side in Supabase Vault and are never exposed to the browser."
        actions={
          <ConnectButton demo={session.demo} configured={configured} mock={mock} />
        }
      />

      <div className="space-y-4">
        <OAuthResultBanner {...params} />

        {mock && !session.demo && (
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-500/25 bg-blue-500/[0.06] px-4 py-3 text-[11.5px] leading-relaxed text-blue-700 dark:text-blue-300">
            <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-semibold">Mock publishing is enabled.</span> Posts are simulated
              and marked with a mock provider ID. This is for workflow testing only — nothing reaches
              LinkedIn. Set <code className="rounded bg-blue-500/10 px-1">LINKEDIN_MOCK_MODE=false</code>{" "}
              to publish for real.
            </span>
          </div>
        )}

        {!configured && !session.demo && mock && (
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-500/25 bg-blue-500/[0.06] px-4 py-3 text-[11.5px] leading-relaxed text-blue-700 dark:text-blue-300">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-semibold">No LinkedIn app configured — mock connect is active.</span>{" "}
              <em>Connect mock LinkedIn</em> creates a simulated account so you can test scheduling,
              the queue and the every-minute publisher. Add{" "}
              <code className="rounded bg-blue-500/10 px-1">LINKEDIN_CLIENT_ID</code> and{" "}
              <code className="rounded bg-blue-500/10 px-1">LINKEDIN_CLIENT_SECRET</code> to use real
              OAuth.
            </span>
          </div>
        )}

        {!configured && !session.demo && !mock && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-semibold">LinkedIn credentials are missing.</span> Add{" "}
              <code className="rounded bg-amber-500/10 px-1">LINKEDIN_CLIENT_ID</code> and{" "}
              <code className="rounded bg-amber-500/10 px-1">LINKEDIN_CLIENT_SECRET</code> to your
              environment, then restart the app. Read the{" "}
              <Link href="/setup" className="font-semibold underline underline-offset-2">
                setup guide
              </Link>
              .
            </span>
          </div>
        )}

        {!session.demo && (
          <CompanyPageChecklist
            organizationScopesConfigured={organizationScopesConfigured}
            accounts={overview.accounts}
            pages={overview.pages}
            hasConnectedAccount={overview.accounts.length > 0}
          />
        )}

        {overview.accounts.length === 0 ? (
          <EmptyState
            icon={Linkedin}
            title="No LinkedIn account connected"
            description="Connect your LinkedIn profile to publish posts, or authorize a company page where you have an admin role. LINKFLOW requests only the permissions it needs."
            actions={
              <ConnectButton demo={session.demo} configured={configured} mock={mock} />
            }
          />
        ) : (
          <div className="space-y-4">
            {overview.accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                pages={overview.pages}
                timezone={timezone}
                demo={session.demo}
                organizationScopesConfigured={organizationScopesConfigured}
              />
            ))}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> How the connection stays secure
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  icon: KeyRound,
                  title: "Tokens live in Vault",
                  body: "Access and refresh tokens are written to Supabase Vault under service-role-only functions. No token column exists on social_accounts.",
                },
                {
                  icon: UserRound,
                  title: "Official OAuth only",
                  body: "LINKFLOW uses LinkedIn's Authorization Code flow with a single-use, server-side state value. Passwords and cookies never touch our servers.",
                },
                {
                  icon: Building2,
                  title: "Page roles are verified",
                  body: "Company page publishing requires w_organization_social plus an Administrator or Content Admin role. Read-only roles are shown but blocked.",
                },
                {
                  icon: CheckCircle2,
                  title: "Every attempt is audited",
                  body: "Each publish attempt writes an immutable publishing_logs row with HTTP status, provider post id and the exact error code.",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-border/70 bg-muted/25 p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                    <item.icon className="size-3.5 text-primary" /> {item.title}
                  </p>
                  <p className="text-muted-foreground mt-1 text-[10.5px] leading-relaxed">{item.body}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Requested scopes</CardTitle>
              <CardDescription>Configured through LINKEDIN_SCOPES.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {requestedScopes.map((scope) => (
                <div
                  key={scope}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/25 px-2.5 py-1.5 text-[11px]"
                >
                  <Check className="size-3 text-emerald-500" />
                  <code>{scope}</code>
                </div>
              ))}
              <a
                href="https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2"
                target="_blank"
                rel="noreferrer"
                className="text-primary mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium hover:underline"
              >
                LinkedIn OAuth documentation <ExternalLink className="size-2.5" />
              </a>

              <div className="mt-2 space-y-1.5 border-t border-border/70 pt-2.5">
                <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Redirect URL in the LinkedIn app
                </p>
                <code className="block rounded-lg bg-muted/40 px-2 py-1.5 text-[10px] break-all">
                  {getLinkedInRedirectUri()}
                </code>
                <p className="text-muted-foreground text-[10px] leading-relaxed">
                  LinkedIn app → Auth → Authorized redirect URLs must contain this exact value.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
