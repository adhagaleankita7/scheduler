import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Database,
  ExternalLink,
  FlaskConical,
  FunctionSquare,
  KeyRound,
  Linkedin,
  Rocket,
  ShieldCheck,
  Terminal,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { CopyButton } from "@/components/setup/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAppUrl,
  getCronSecret,
  getLinkedInScopes,
  getSupabasePublicKey,
  getSupabaseUrl,
  isDemoMode,
  isLinkedInConfigured,
  isLinkedInMockMode,
  isServiceRoleConfigured,
  isSupabaseConfigured,
} from "@/lib/env";
import {
  getLinkedInRedirectUri,
  isSecureRedirectUri,
} from "@/lib/linkedin/oauth";
import {
  hasOrganizationAdminScope,
  hasOrganizationPublishScope,
  splitRequestedScopes,
} from "@/lib/linkedin/scopes";

export const metadata: Metadata = { title: "Setup guide" };
export const dynamic = "force-dynamic";

/**
 * The environment can be configured while the database is still empty. A
 * missing schema is the most common setup failure, so check it honestly
 * instead of reporting "ready" from env vars alone.
 */
async function checkDatabaseSchema(): Promise<boolean | null> {
  const url = getSupabaseUrl();
  const key = getSupabasePublicKey();
  if (!url || !key) return null;
  try {
    const response = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (response.status === 404) return false;
    if (!response.ok) return null;
    return true;
  } catch {
    return null;
  }
}

function CodeBlock({ code, title }: { code: string; title?: string }) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/80 bg-[#0b1020] text-[#dbe4ff]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono text-[10px] tracking-wide text-white/50 uppercase">
          {title ?? "terminal"}
        </span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[11px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Step({
  number,
  icon: Icon,
  title,
  description,
  children,
}: {
  number: number;
  icon: React.ElementType;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3">
        <span className="brand-gradient grid size-8 shrink-0 place-items-center rounded-lg text-[12px] font-bold text-white">
          {number}
        </span>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-4 text-primary" /> {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      {children && <CardContent className="text-[12px] leading-relaxed">{children}</CardContent>}
    </Card>
  );
}

function Readiness({
  label,
  ready,
  detail,
  optional = false,
}: {
  label: string;
  ready: boolean;
  detail: string;
  optional?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2.5">
      {ready ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
      )}
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold">
          {label}
          <Badge variant={ready ? "success" : optional ? "outline" : "warning"} className="px-1.5 py-0 text-[9px]">
            {ready ? "Ready" : optional ? "Optional" : "Missing"}
          </Badge>
        </p>
        <p className="text-muted-foreground mt-0.5 truncate text-[10.5px]" title={detail}>
          {detail}
        </p>
      </div>
    </div>
  );
}

export default async function SetupPage() {
  const supabaseReady = isSupabaseConfigured();
  const schemaReady = supabaseReady ? await checkDatabaseSchema() : null;
  const serviceReady = isServiceRoleConfigured();
  const linkedinReady = isLinkedInConfigured();
  const cronReady = Boolean(getCronSecret());
  const appUrl = getAppUrl();
  const redirectUri = getLinkedInRedirectUri(appUrl);
  const secureRedirect = isSecureRedirectUri(redirectUri);
  const mock = isLinkedInMockMode();
  const demo = isDemoMode();
  const requestedOrgScopes = splitRequestedScopes(
    getLinkedInScopes().split(/[\s,]+/).filter(Boolean),
  ).organization;
  const orgScopesConfigured =
    hasOrganizationPublishScope(requestedOrgScopes) &&
    hasOrganizationAdminScope(requestedOrgScopes);

  const envExample = `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
# Legacy projects may use NEXT_PUBLIC_SUPABASE_ANON_KEY instead.
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
NEXT_PUBLIC_APP_URL=${appUrl}

LINKEDIN_CLIENT_ID=<linkedin-client-id>
LINKEDIN_CLIENT_SECRET=<linkedin-client-secret>
# Personal set works out of the box. Company-page scopes are safe to add before
# approval: LINKFLOW retries with personal scopes instead of failing until
# LinkedIn approves the Community Management API for this app.
LINKEDIN_SCOPES=openid profile email w_member_social w_organization_social r_organization_admin
LINKEDIN_API_VERSION=202610
# Optional: HTTPS tunnel callback while NEXT_PUBLIC_APP_URL stays localhost.
# LINKEDIN_REDIRECT_URI=https://<tunnel-host>/api/linkedin/callback

# Development only. Never enable either of these in production.
LINKFLOW_DEMO_MODE=0
LINKEDIN_MOCK_MODE=false

CRON_SECRET=<long-random-string>`;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="LINKFLOW home">
            <Logo />
          </Link>
          <Badge variant="outline" className="ml-1">
            Setup
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="gradient" size="sm">
              <Link href={supabaseReady ? "/dashboard" : "/login"}>
                {supabaseReady ? "Open dashboard" : "Sign in"} <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="mb-8">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
            Production setup
          </p>
          <h1 className="font-display mt-2 text-[30px] leading-tight font-bold tracking-[-0.035em] sm:text-[36px]">
            Take LINKFLOW from demo to live
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-[13px] leading-relaxed">
            LINKFLOW runs on Next.js, Supabase (Auth, Postgres, Storage, Vault, Edge Functions) and the
            official LinkedIn API. Follow these steps once, verify the workflow in mock mode, then flip
            the switch to real publishing.
          </p>
        </div>

        {/* Readiness */}
        <Card className="mb-6">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Environment readiness
              </CardTitle>
              <CardDescription>What this deployment can do right now.</CardDescription>
            </div>
            <Badge variant={supabaseReady && serviceReady && linkedinReady && cronReady && secureRedirect ? "success" : "warning"}>
              {supabaseReady && serviceReady && linkedinReady && cronReady && secureRedirect
                ? "Ready to publish"
                : "Setup incomplete"}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Readiness label="Supabase URL & public key" ready={supabaseReady} detail="NEXT_PUBLIC_SUPABASE_URL + publishable/anon key" />
            <Readiness
              label="Database schema"
              ready={schemaReady === true}
              detail={
                schemaReady === true
                  ? "profiles/posts/queue tables detected"
                  : schemaReady === false
                    ? "Tables missing — apply the migrations in step 2"
                    : "Could not verify (apply the migrations in step 2)"
              }
            />
            <Readiness label="Service role key" ready={serviceReady} detail="SUPABASE_SERVICE_ROLE_KEY (server and Edge Function only)" />
            <Readiness label="LinkedIn OAuth app" ready={linkedinReady} detail="LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET" />
            <Readiness
              label="Company page publishing"
              ready={orgScopesConfigured}
              detail={
                orgScopesConfigured
                  ? "Org scopes requested — needs LinkedIn approval plus a Super/Content Admin page role, then Reconnect on /accounts."
                  : "Not requested — add w_organization_social + r_organization_admin to LINKEDIN_SCOPES."
              }
              optional
            />
            <Readiness
              label="HTTPS OAuth redirect"
              ready={secureRedirect}
              detail={
                secureRedirect
                  ? redirectUri
                  : "LinkedIn rejects http:// redirects. Use an HTTPS deployment or tunnel and register the exact callback URL."
              }
            />
            <Readiness label="Cron shared secret" ready={cronReady} detail="CRON_SECRET, also stored in Vault as linkflow_cron_secret" />
            <Readiness label="Demo fixtures" ready={demo} detail="LINKFLOW_DEMO_MODE=1 (development only)" optional />
            <Readiness label="Mock publishing" ready={mock} detail="LINKEDIN_MOCK_MODE=true (never with LINKFLOW_ENV=production)" optional />
          </CardContent>
          {!supabaseReady && (
            <CardContent className="pt-0">
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                This page is visible before Supabase is configured. Once the URL and anon key are set,
                sign in to reach the workspace.
              </div>
            </CardContent>
          )}
          {supabaseReady && schemaReady === false && (
            <CardContent className="pt-0">
              <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-[11.5px] leading-relaxed text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Supabase is connected but the LINKFLOW tables do not exist yet. Paste{" "}
                <span className="font-mono">supabase/linkflow_full_schema.sql</span> into the Supabase
                SQL Editor and run it once (or apply the files in{" "}
                <span className="font-mono">supabase/migrations/</span> in filename order, or run{" "}
                <span className="font-mono">supabase db push</span>), then reload this page. Auth will
                not work until <span className="font-mono">profiles</span> exists.
              </div>
            </CardContent>
          )}
        </Card>

        <div className="space-y-4">
          <Step
            number={1}
            icon={Terminal}
            title="Install and configure environment"
            description="Copy the example env file and fill in real values. Never commit secrets."
          >
            <CodeBlock
              code={`cp .env.example .env.local
npm install
npm run dev`}
            />
            <CodeBlock code={envExample} title=".env.local" />
            <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-[11px]">
              <TriangleAlert className="mt-0.5 size-3 shrink-0 text-amber-500" />
              The service role key bypasses Row Level Security. Keep it server-side; never prefix it
              with <code className="rounded bg-muted px-1">NEXT_PUBLIC_</code> or expose it to the
              browser.
            </p>
          </Step>

          <Step
            number={2}
            icon={Database}
            title="Create the database, RLS and storage"
            description="Apply the migrations to your Supabase project. They are idempotent."
          >
            <CodeBlock
              code={`# Fastest path: one file, one paste
supabase/linkflow_full_schema.sql

# Regenerate the bundle after editing any migration
npm run sql:bundle

# Or use the CLI
supabase login
supabase link --project-ref <project-ref>
supabase db push`}
            />
            <p className="text-muted-foreground mt-3 text-[11.5px] leading-relaxed">
              Open the SQL Editor for your project, paste the contents of{" "}
              <code className="rounded bg-muted px-1">supabase/linkflow_full_schema.sql</code>, and run
              it. It is every migration concatenated in order and is safe to re-run. The
              migrations create profiles, accounts, pages, posts, media, logs and queue settings
              with Row Level Security; the private <code className="rounded bg-muted px-1">post-media</code>{" "}
              bucket; Vault token functions; atomic publishing claim functions; and the every-minute
              cron job.
            </p>
          </Step>

          <Step
            number={3}
            icon={KeyRound}
            title="Configure Supabase Auth emails"
            description="Email links must land on the callback route so LINKFLOW can set a session cookie."
          >
            <p className="text-muted-foreground text-[11.5px] leading-relaxed">
              In Supabase Dashboard → Authentication → URL Configuration, set the Site URL to{" "}
              <code className="rounded bg-muted px-1">{appUrl}</code> and add{" "}
              <code className="rounded bg-muted px-1">{appUrl}/auth/callback</code> as a redirect URL.
              Then update the email templates:
            </p>
            <CodeBlock
              code={`{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard`}
              title="Confirm signup"
            />
            <CodeBlock
              code={`{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`}
              title="Reset password"
            />
            <p className="text-muted-foreground mt-3 text-[11px]">
              The callback supports both PKCE (<code className="rounded bg-muted px-1">?code=</code>)
              and OTP (<code className="rounded bg-muted px-1">?token_hash=</code>) links.
            </p>
            <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
              Optional social sign-in: enable Google under Authentication → Providers → Google
              and register{" "}
              <code className="rounded bg-muted px-1">
                https://&lt;project-ref&gt;.supabase.co/auth/v1/callback
              </code>{" "}
              as the authorized redirect URI in Google Cloud Console. Buttons are rendered from{" "}
              <code className="rounded bg-muted px-1">NEXT_PUBLIC_AUTH_PROVIDERS</code> (default{" "}
              <code className="rounded bg-muted px-1">google</code>; also{" "}
              <code className="rounded bg-muted px-1">github</code> and{" "}
              <code className="rounded bg-muted px-1">linkedin_oidc</code>).
            </p>
          </Step>

          <Step
            number={4}
            icon={FunctionSquare}
            title="Deploy the publishing Edge Function"
            description="One function claims due posts atomically and publishes them with retries."
          >
            <CodeBlock
              code={`supabase functions deploy publish-scheduled-posts --no-verify-jwt

supabase secrets set \\
  CRON_SECRET=<same-value-as-env> \\
  LINKEDIN_CLIENT_ID=<client-id> \\
  LINKEDIN_CLIENT_SECRET=<client-secret> \\
  LINKEDIN_API_VERSION=202610 \\
  LINKFLOW_ENV=production`}
            />
            <p className="text-muted-foreground mt-3 text-[11.5px] leading-relaxed">
              Supabase injects <code className="rounded bg-muted px-1">SUPABASE_URL</code> and{" "}
              <code className="rounded bg-muted px-1">SUPABASE_SERVICE_ROLE_KEY</code> into Edge
              Functions automatically. The function refuses to run mock mode when{" "}
              <code className="rounded bg-muted px-1">LINKFLOW_ENV=production</code>.
            </p>
          </Step>

          <Step
            number={5}
            icon={Timer}
            title="Store Vault secrets for cron"
            description="pg_cron → pg_net calls the function every minute using a shared secret."
          >
            <CodeBlock
              code={`select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/publish-scheduled-posts',
  'linkflow_function_url',
  'LINKFLOW publisher Edge Function URL'
);

select vault.create_secret(
  '<same CRON_SECRET value>',
  'linkflow_cron_secret',
  'LINKFLOW cron shared secret'
);

-- Smoke-test the trigger (returns the pg_net request id).
select public.trigger_publish_function();`}
              title="SQL editor"
            />
            <p className="text-muted-foreground mt-3 text-[11px]">
              Until both secrets exist the cron job runs but intentionally does nothing — no failed
              requests, no noise.
            </p>
          </Step>

          <Step
            number={6}
            icon={Linkedin}
            title="Create and approve the LinkedIn app"
            description="Only the official LinkedIn API is used. Company pages need extra approval."
          >
            <ul className="text-muted-foreground space-y-1.5 text-[11.5px]">
              <li>• Create an app at developer.linkedin.com and verify it with your company page.</li>
              <li>
                • Add <strong>Sign In with LinkedIn using OpenID Connect</strong> and{" "}
                <strong>Share on LinkedIn</strong> products for personal posting.
              </li>
              <li>
                • Request <strong>Community Management API</strong> access for company page posting
                and role discovery.
              </li>
              <li>
                • Ask the page owner to add you as <strong>Super Admin</strong> or{" "}
                <strong>Content Admin</strong> (Page → Admin tools → Manage admins). Analysts and
                Recruiters cannot publish.
              </li>
              <li>
                • Organization scopes can be listed before approval: if LinkedIn rejects them,
                LINKFLOW automatically retries with personal scopes so publishing never breaks. Click{" "}
                <strong>Reconnect</strong> on <code className="rounded bg-muted px-1">/accounts</code>{" "}
                after approval.
              </li>
              <li>
                • Add the redirect URL{" "}
                <code className="rounded bg-muted px-1">{redirectUri}</code>. It must be HTTPS and
                match exactly (no trailing slash, query string, or different path).
              </li>
              <li>
                • Requested scopes:{" "}
                <code className="rounded bg-muted px-1">{getLinkedInScopes()}</code>.
              </li>
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://www.linkedin.com/developers/apps"
                  target="_blank"
                  rel="noreferrer"
                >
                  LinkedIn developer portal <ExternalLink className="size-3.5" />
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview"
                  target="_blank"
                  rel="noreferrer"
                >
                  Community Management API <ExternalLink className="size-3.5" />
                </a>
              </Button>
            </div>
          </Step>

          <Step
            number={7}
            icon={FlaskConical}
            title="Verify the workflow before going live"
            description="Prove the whole pipeline with mock publishing, then switch to real tokens."
          >
            <CodeBlock
              code={`# 1. Read-only UI tour without any credentials
LINKFLOW_DEMO_MODE=1 npm run dev

# 2. Full workflow with real Supabase, simulated LinkedIn
LINKEDIN_MOCK_MODE=true npm run dev

# 3. Quality gates
npm run typecheck
npm run lint
npm run test
npm run build

# 4. End-to-end workflow check
npm run verify:workflow`}
            />
            <p className="text-muted-foreground mt-3 text-[11.5px] leading-relaxed">
              With mock mode on and no LinkedIn client credentials,{" "}
              <code className="rounded bg-muted px-1">/accounts</code> offers{" "}
              <strong>Connect mock LinkedIn</strong> so you can test scheduling, the queue, and the
              every-minute publisher without a LinkedIn app. Mock posts are stored with{" "}
              <code className="rounded bg-muted px-1">is_mock = true</code> and a mock provider ID,
              and the UI labels them clearly. Disable{" "}
              <code className="rounded bg-muted px-1">LINKEDIN_MOCK_MODE</code> only after you have an
              approved LinkedIn app and real OAuth tokens.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild variant="gradient" size="sm">
                <Link href="/accounts">
                  <Rocket className="size-3.5" /> Connect LinkedIn
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/queue">
                  <Rocket className="size-3.5" /> Open the queue
                </Link>
              </Button>
            </div>
          </Step>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold">
              <ShieldCheck className="size-3.5 text-emerald-500" /> Security model
            </p>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              RLS isolates every workspace. OAuth tokens live in Vault behind service-role RPCs.
              Publishing claims are atomic, and a unique index prevents duplicate provider posts.
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold">
              <Terminal className="size-3.5 text-primary" /> More documentation
            </p>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              See <code className="rounded bg-muted px-1">README.md</code>,{" "}
              <code className="rounded bg-muted px-1">docs/DEPLOYMENT.md</code>,{" "}
              <code className="rounded bg-muted px-1">docs/TESTING.md</code> and{" "}
              <code className="rounded bg-muted px-1">docs/LINKEDIN_APPROVAL.md</code> in the repository.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
