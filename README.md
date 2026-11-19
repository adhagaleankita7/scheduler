# LINKFLOW

**LinkedIn and Facebook scheduling that runs itself.** Plan a week of posts in one sitting, queue
them at 10:00 AM in your timezone, and let a Supabase-backed publishing engine deliver them through
the official LinkedIn and Facebook APIs — with retries, audit logs, and no duplicate posts.

LINKFLOW is a production-oriented Next.js application, not a static demo. It ships with real
Supabase Auth, Postgres + Row Level Security, private media storage, Supabase Vault token storage,
an Edge Function publishing worker, and `pg_cron` + `pg_net` scheduling.

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Database migrations](#database-migrations)
- [The 7- and 30-day workflows](#the-7--and-30-day-workflows)
- [Workspaces and collaborators](#workspaces-and-collaborators)
- [Publishing engine](#publishing-engine)
- [Security model](#security-model)
- [Demo and mock modes](#demo-and-mock-modes)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Documentation](#documentation)
- [Limitations](#limitations)

---

## What it does

- **Connect LinkedIn** through the official OAuth 2.0 Authorization Code flow. Publish as a
  personal profile (`w_member_social`) or an authorized company page (`w_organization_social`).
- **Connect Facebook Pages** through Facebook Login. Meta's Graph API only allows automated posting
  to Pages (never personal profiles), so LINKFLOW imports the Pages your role can publish to and
  publishes with `pages_manage_posts`.
- **Write a week or a month in one sitting.** The planner takes either seven or thirty posts, one
  per day, with a shared default time (10:00 AM by default) and per-day overrides.
- **Schedule all of them in one click.** Timestamps are computed in your timezone (Asia/Kolkata by
  default) and stored in UTC.
- **Publish automatically.** `pg_cron` calls the `publish-scheduled-posts` Edge Function every
  minute. It claims due posts atomically and publishes them via the LinkedIn Posts API or the
  Facebook Graph API, depending on the target.
- **Track everything.** Dashboard charts, status ring, upcoming queue, publishing history, and
  immutable attempt logs.
- **Stay in control.** Pause the queue, resume it, reorder slots, retry failures, cancel, duplicate,
  or drag posts to another day on the calendar.
- **Work with collaborators.** Invite teammates by email from Settings. Editors see the same
  accounts, plans, posts, calendar and analytics as the owner — and can publish too. Owners manage
  members and roles; everyone can switch between workspaces they belong to.
- **Premium UI.** Light and dark themes, responsive layout, loading skeletons, empty states, and
  clear error surfaces.

### Status model

| Status | Meaning |
| --- | --- |
| `draft` | Written but not scheduled. |
| `scheduled` | Queued with a UTC `scheduled_for` timestamp (may include a retry `next_retry_at`). |
| `processing` | Atomically claimed by a worker and currently being delivered. |
| `published` | The provider accepted the post; `provider_post_id` and URL are stored. |
| `failed` | Terminal failure after retries or a non-retryable provider error. |
| `cancelled` | Deliberately stopped. Content is kept so it can be duplicated or retried. |

---

## Architecture

```
Browser (Next.js App Router, RSC + server actions)
   │
   ├── Supabase Auth (email/password, cookie sessions via @supabase/ssr)
   ├── Postgres + RLS (profiles, social_accounts, social_pages, posts,
   │                    post_media, publishing_logs, queue_settings, schedules)
   ├── Storage (private `post-media` bucket, workspace-shared paths, signed URLs)
   └── Vault (provider-prefixed access + refresh tokens, service-role RPCs only)

pg_cron (every minute)
   └── pg_net → Edge Function `publish-scheduled-posts`
          ├── claim_due_posts()  (FOR UPDATE SKIP LOCKED, pause-aware)
          ├── get_social_tokens() / refresh token when near expiry
          ├── LinkedIn Posts API (+ image upload when media exists)
          ├── Facebook Graph API (Page feed or Page photo)
          ├── mark_post_published() / mark_post_failed()
          └── publishing_logs (one row per attempt)
```

**Why a separate Edge Function?** Server actions handle user intent; the worker owns delivery.
Splitting them means publishing continues while nobody has the dashboard open, and the same
atomic claim function protects against overlapping cron invocations.

**Shared publishing core.** `supabase/functions/_shared/linkedin.ts` and
`supabase/functions/_shared/facebook.ts` are runtime-agnostic (`fetch` + `Uint8Array` only). The Edge
Function imports them directly, and the Vitest suite tests the exact same code — there is no second
mock implementation pretending to be the real one.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, React 19, server actions) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + hand-authored shadcn/ui-style primitives on Radix |
| Icons | Lucide |
| Validation | Zod |
| Dates | `date-fns` + `date-fns-tz` |
| Backend | Supabase (Auth, Postgres, Storage, Vault, Edge Functions) |
| Scheduler | `pg_cron` + `pg_net` |
| Tests | Vitest (+ pgTAP SQL tests for RLS and claim behaviour) |
| Notifications | Sonner |

---

## Quick start

### 0. Requirements

- Node.js 20+ (developed on Node 26)
- npm 10+
- A Supabase project (hosted) — or the Supabase CLI + Docker for local development
- A LinkedIn developer app for real publishing (optional for the demo)

### 1. Install

```bash
npm install
cp .env.example .env.local
```

Fill in at least `NEXT_PUBLIC_SUPABASE_URL` and one public key — either
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (newer projects, `sb_publishable_…`) or
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy anon JWT) — plus `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Apply the database migrations

Fastest path — paste one file into the Supabase SQL editor and run it:

```text
supabase/linkflow_full_schema.sql
```

That file is every migration concatenated in order and is safe to re-run. After editing any
migration, regenerate it with `npm run sql:bundle`.

With the CLI instead:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

No CLI and no database password? Create a personal access token at
https://supabase.com/dashboard/account/tokens, add `SUPABASE_ACCESS_TOKEN=sbp_…` to
`.env.local`, then run:

```bash
npm run db:push:api
```

That applies the migrations through the Management API and verifies the tables, policies,
storage bucket and cron jobs afterwards.

Or paste `supabase/migrations/*.sql` into the Supabase SQL editor **in filename order**.

Verify it worked by loading `/setup`: the database row should read ready.

### 3. Configure auth emails

In Supabase → Authentication → URL Configuration:

- Site URL: `http://localhost:3000` (or your production origin)
- Redirect URLs: `http://localhost:3000/auth/callback`

Update the email templates so links land on the callback route:

```text
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
```

### 3b. Enable social sign-in (optional)

Email/password always works. To add a **Continue with Google** button:

1. In Google Cloud Console → APIs & Services → Credentials, create an OAuth client ID
   (application type **Web application**).
   - Authorized JavaScript origins: `http://localhost:3000` and your production origin.
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
     (for local Supabase: `http://127.0.0.1:54321/auth/v1/callback`).
2. In Supabase → Authentication → Providers → Google, enable the provider and paste the
   client ID and client secret.
3. Keep `http://localhost:3000/auth/callback` in Authentication → URL Configuration →
   Redirect URLs. Supabase returns the PKCE code there and LINKFLOW exchanges it for a
   cookie session.
4. `NEXT_PUBLIC_AUTH_PROVIDERS` controls which buttons render. It defaults to `google`;
   use `google,github,linkedin_oidc` for more, or `none` to hide the section.

The redirect URI registered with Google is the Supabase project's
`/auth/v1/callback`, **not** the app's `/auth/callback`: Google talks to Supabase, and
Supabase talks back to the app.

### 4. Deploy the publishing function

```bash
supabase functions deploy publish-scheduled-posts --no-verify-jwt
supabase secrets set \
  CRON_SECRET=<same-value-as-env> \
  LINKEDIN_CLIENT_ID=<client-id> \
  LINKEDIN_CLIENT_SECRET=<client-secret> \
  LINKEDIN_API_VERSION=202610 \
  LINKFLOW_ENV=production
```

### 5. Store the cron secrets in Vault

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/publish-scheduled-posts',
  'linkflow_function_url',
  'LINKFLOW publisher Edge Function URL'
);

select vault.create_secret(
  '<same CRON_SECRET value>',
  'linkflow_cron_secret',
  'LINKFLOW cron shared secret'
);
```

Until both secrets exist, the cron job runs but intentionally does nothing.

### 6. Run

```bash
npm run dev
```

Open <http://localhost:3000>, sign up, connect LinkedIn, then open the **30-day planner** (or the
**7-day planner** for a shorter batch).

For a credential-free tour, see [Demo and mock modes](#demo-and-mock-modes).

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes* | Newer public key (`sb_publishable_…`). Preferred for new projects. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes* | Legacy anon JWT. Either this or the publishable key is required. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only. Bypasses RLS; used by OAuth callbacks, token RPCs, and admin actions. |
| `NEXT_PUBLIC_APP_URL` | yes | Public origin used for OAuth redirects and email links. Must be HTTPS for LinkedIn OAuth. |
| `LINKEDIN_CLIENT_ID` | for real publishing | LinkedIn app client id. |
| `LINKEDIN_CLIENT_SECRET` | for real publishing | LinkedIn app client secret. |
| `LINKEDIN_SCOPES` | recommended | Defaults to `openid profile email w_member_social`. `w_organization_social r_organization_admin` can be added before approval: LINKFLOW retries with personal scopes only when LinkedIn rejects them, so personal publishing never breaks. |
| `LINKEDIN_API_VERSION` | recommended | Marketing API version header. Defaults to `202610`. |
| `LINKEDIN_REDIRECT_URI` | optional | Overrides `${NEXT_PUBLIC_APP_URL}/api/linkedin/callback`. Must be HTTPS and end exactly with `/api/linkedin/callback`; use it for an HTTPS tunnel while `NEXT_PUBLIC_APP_URL` stays `http://localhost:3000`. |
| `FACEBOOK_APP_ID` | for Facebook | Meta app id (Facebook Login product). |
| `FACEBOOK_APP_SECRET` | for Facebook | Meta app secret. Server-only. |
| `FACEBOOK_SCOPES` | recommended | Defaults to `public_profile pages_show_list pages_read_engagement pages_manage_posts`. |
| `FACEBOOK_GRAPH_VERSION` | recommended | Graph API version for OAuth and publishing. Defaults to `v23.0`. |
| `FACEBOOK_REDIRECT_URI` | optional | Overrides `${NEXT_PUBLIC_APP_URL}/api/facebook/callback`. Register the exact value in the Meta app. |
| `SUPABASE_FUNCTION_URL` | optional | Overrides `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1`. |
| `CRON_SECRET` | yes for automation | Shared secret for the Edge Function. |
| `LINKFLOW_DEMO_MODE` | dev only | `1` serves read-only fixtures without Supabase. |
| `LINKEDIN_MOCK_MODE` | dev only | `true` simulates LinkedIn publishing. Blocked in production. |
| `FACEBOOK_MOCK_MODE` | dev only | `true` simulates Facebook publishing. Blocked in production. |
| `LINKFLOW_ENV` | optional | Set to `production` on the Edge Function to hard-block mock publishing. |

Full template: [`.env.example`](.env.example).

> **Never commit secrets.** `.env.local` is git-ignored. The service role key must never be exposed
> to the browser or prefixed with `NEXT_PUBLIC_`.

---

## Database migrations

| File | Contents |
| --- | --- |
| `20260101000100_core_schema.sql` | Tables, enums, indexes, RLS policies, storage bucket + policies, profile/queue bootstrap triggers, publishing-field protection trigger. |
| `20260101000200_publishing_engine.sql` | Vault token RPCs, `claim_due_posts`, `mark_post_published`, `mark_post_failed`, `trigger_publish_function`, grants. |
| `20260101000300_cron.sql` | `pg_cron` + `pg_net` extensions, every-minute publish job, hourly OAuth state cleanup. |
| `20261114000000_oauth_profile_metadata.sql` | Captures OAuth name/avatar metadata for new profiles and backfills existing rows. |
| `20261114000100_health.sql` | Service-role-only `linkflow_health()` readiness report (cron, Vault, storage, tables). |
| `20261115000000_oauth_state_scopes.sql` | Records the scopes each OAuth attempt requested, so the personal-only fallback resolves granted scopes correctly. |
| `20261116000000_facebook_provider.sql` | Adds the `facebook` provider to accounts, pages, logs and OAuth state; provider-scoped page uniqueness; provider-prefixed Vault token names. |

Migrations are written to be re-runnable where practical. Apply in order.

### Readiness check

```bash
npm run doctor
```

Checks env presence, the exact HTTPS LinkedIn redirect path, REST table/RPC availability, Edge
Function deployment, and — when `SUPABASE_SERVICE_ROLE_KEY` is present — cron jobs, Vault secrets and
the storage bucket. It never prints secret values. In mock mode the LinkedIn OAuth checks are
warnings, since mock connect does not need a LinkedIn app.

---

## The 7- and 30-day workflows

1. **Connect** — `/accounts` → *Connect LinkedIn*. Tokens are written to Vault by the server; the
   browser never sees them.
2. **Plan** — `/planner` for seven days or `/planner/month` for thirty. Choose target, start date
   (defaults to next Monday), plan name, and default time (10:00 AM). Write up to seven or thirty
   posts; empty days are skipped.
3. **Schedule all** — one server action validates every entry, converts each wall-clock time to UTC,
   and inserts the posts as `scheduled`.
4. **Publish** — the cron job wakes the Edge Function every minute. Due posts are claimed and
   published. Failures retry with exponential backoff.
5. **Track** — `/dashboard`, `/queue`, `/calendar`, and `/posts` show live status. Successful posts
   link to LinkedIn.

Other entry points:

- `/composer` — single post with preview, media upload, alt text, draft/schedule/publish-now.
- `/queue` — next open slots, pause/resume, reorder, promote drafts, up to four daily slots.
- `/calendar` — month/week/day views with drag-and-drop day rescheduling.
- `/settings` — profile, timezone, default time and days, theme, queue pause, members and invites.

---

## Workspaces and collaborators

Everything in LINKFLOW belongs to a **workspace**, not to a single account:

- Every user gets a personal workspace on signup.
- Inviting someone from **Settings → Members & collaborators** adds them to your workspace. Existing
  users join immediately; a new email is accepted automatically when that person signs up with it.
- Members with the **editor** role see and edit the same accounts, plans, posts, media, queue and
  analytics as the owner, and can publish. **Viewers** are read-only.
- Only the **owner** can invite people, change roles, or remove members.
- The workspace switcher in the sidebar moves a user between their personal workspace and any
  workspace they have joined.

The migration `20261119000100_workspaces.sql` adds `workspace_id` to every content table, replaces
the old per-user RLS with workspace roles (`is_workspace_member`, `can_edit_workspace`,
`is_workspace_owner`), and lets teammates read each other's post images. The publishing worker looks
up the **account owner's** token and page, so a collaborator can publish to an account the owner
connected.

---

## Publishing engine

- **Every minute** `pg_cron` calls `public.trigger_publish_function()`, which reads the function URL
  and shared secret from Vault and POSTs through `pg_net`.
- The function requires `x-cron-secret` (or a service-role bearer token). Unauthorized requests are
  rejected with `401`.
- `claim_due_posts(worker, limit)` selects at most 20 due posts with `FOR UPDATE SKIP LOCKED`,
  increments `attempt_count`, sets `status = 'processing'`, and stamps `locked_at` / `locked_by`.
  Paused queues are skipped. Posts abandoned by a crashed worker for more than 15 minutes are
  requeued or terminally failed.
- The worker refreshes the access token when it is within five minutes of expiry, using the refresh
  token from Vault and the LinkedIn token endpoint.
- **Success** is recorded only if the post is still `processing`
  (`mark_post_published` returns row count 1). Provider post ids are unique per account, so a second
  worker cannot create a duplicate row.
- **Failure** is classified:
  - Non-retryable: `invalid_token`, `expired_token`, `missing_permissions`, `duplicate_post`,
    `invalid_content` → `status = 'failed'`.
  - Retryable: `rate_limited`, `network_error`, `linkedin_server_error`, image upload failures →
    back to `scheduled` with `next_retry_at = now + min(2^(attempt-1) × 60s, 1h)`.
- Every attempt writes a `publishing_logs` row. See [docs/publishing-model.md](docs/publishing-model.md)
  for the full state machine and error table.

---

## Security model

- **RLS everywhere.** Every table is scoped to `auth.uid()`. The service role is used only in
  server-side code and the Edge Function.
- **Tokens in Vault.** `social_accounts` has no token columns. `store_social_tokens`,
  `get_social_tokens`, `touch_social_token_refresh`, and `delete_social_tokens` are `security
  definer` and granted only to `service_role`.
- **OAuth hardening.** A random `state` stored server-side with an expiry, and a strict callback that
  validates and consumes it before exchanging the code. LinkedIn's token endpoint rejects the
  exchange with `invalid_client` whenever a PKCE `code_verifier` is sent, so LINKFLOW deliberately
  does not use PKCE; the client secret stays server-side and the state row makes the code single-use.
- **Engine fields are protected.** A trigger blocks browser clients from writing
  `provider_post_id`, `published_at`, `attempt_count`, `locked_at`, retry fields, or creating posts
  directly in `processing`/`published`.
- **Private media.** The `post-media` bucket is private; uploads must be under `${userId}/…` and
  reads use short-lived signed URLs.
- **No fake success.** Mock results are recorded with `is_mock = true` and a `mock_` provider id, and
  the UI labels them. Production + mock is a hard error.

---

## Demo and mock modes

| Mode | Env | What it does | Safety |
| --- | --- | --- | --- |
| Demo | `LINKFLOW_DEMO_MODE=1` | Read-only fixtures for the whole dashboard without Supabase. Actions return a clear demo error. | Disabled when `NODE_ENV=production`. |
| Mock publishing | `LINKEDIN_MOCK_MODE=true` | Full workflow against real Supabase, but LinkedIn calls are simulated. Posts are marked `is_mock`. | Disabled in production and refused by the Edge Function when `LINKFLOW_ENV=production`. |
| Mock Facebook | `FACEBOOK_MOCK_MODE=true` | Same workflow, but Facebook Graph calls are simulated. Posts are marked `is_mock`. | Disabled in production and refused by the Edge Function when `LINKFLOW_ENV=production`. |

With mock mode on and no `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`, `/accounts` shows
**Connect mock LinkedIn**. It writes a clearly labelled `mock_member_…` account and a dummy token
through the real `store_social_tokens` RPC, so scheduling, the queue, cron and the Edge Function can
be tested end-to-end without a LinkedIn app. The **Mock** badge and banner stay visible.

Facebook works the same way: `FACEBOOK_MOCK_MODE=true` adds **Connect mock Facebook**, which creates
a mock member plus a mock Page. Mock publishing is decided per post provider, so one platform can be
simulated while the other publishes for real.

Mock *accounts* are recognised by their `mock_member_…` / `mock_facebook_…` id, so a post aimed at
one is always simulated — even on the hosted worker, where the env flags above are refused. That
makes a local UI against the hosted database usable for testing without ever touching Meta or
LinkedIn.

Neither mode ever claims to be real publishing. The UI shows a banner in both cases.

---

## Scripts

```bash
npm run dev              # Next.js dev server
npm run build            # Production build
npm run start            # Serve the production build
npm run lint             # ESLint (next/core-web-vitals + typescript)
npm run typecheck        # tsc --noEmit
npm run test             # Vitest unit/integration suite
npm run test:watch       # Vitest in watch mode
npm run test:coverage    # Coverage report
npm run test:db          # pgTAP tests (requires Supabase CLI + Docker)
npm run verify:workflow  # End-to-end workflow verification script
```

---

## Project structure

```
src/
  app/
    (app)/                # Authenticated workspace (dashboard, composer, planner, …)
    (auth)/               # Login, signup, forgot/reset password
    api/linkedin/         # OAuth connect + callback routes
    auth/callback/        # Supabase PKCE + OTP callback
    setup/                # Public setup/readiness guide
  components/
    accounts/ calendar/ composer/ layout/ planner/ posts/ queue/ settings/
    shared/               # Badges, cards, charts, previews, empty states
    ui/                   # Radix-based primitives
  lib/
    actions/              # Server actions (posts, queue, settings, accounts)
    auth/                 # Auth server actions
    data/                 # Server-side read layer
    demo/                 # Demo fixtures
    linkedin/             # OAuth helpers
    scheduling/           # Timezone, slots and calendar math
    supabase/             # Browser, server and admin clients
supabase/
  migrations/             # Schema, engine, cron
  functions/
    _shared/linkedin.ts   # Shared publishing core
    publish-scheduled-posts/
  tests/                  # pgTAP tests
scripts/                  # verify-workflow.ts
docs/                     # Deployment, testing, LinkedIn approval, publishing model
```

---

## Documentation

- [Go-live runbook](docs/GO_LIVE.md) — shortest safe path from checkout to real publishing.
- [Deployment](docs/DEPLOYMENT.md) — production checklist for Vercel + Supabase.
- [Testing](docs/TESTING.md) — unit, SQL, and workflow verification.
- [LinkedIn app approval](docs/LINKEDIN_APPROVAL.md) — scopes, products, and company page access.
- [Facebook setup](docs/FACEBOOK_SETUP.md) — Meta app, redirect URI, App Review, and troubleshooting.
- [Publishing model](docs/publishing-model.md) — state machine, retries, idempotency.

---

## Limitations

- Real publishing requires an approved LinkedIn app. Company page publishing additionally requires
  the Community Management API and an Administrator or Content Admin role on the page.
- Facebook publishing is **Pages only** — Meta's Graph API cannot post to personal profiles. Live
  publishing needs `pages_manage_posts` through App Review + business verification, and a Page role
  that allows creating content.
- LinkedIn access tokens are long-lived (typically 60 days); refresh tokens are used when available.
  When both expire, the account must reconnect.
- The in-app setup page and docs describe the hosted Supabase flow. Local Supabase requires Docker.
- No analytics beyond publishing activity: LINKFLOW does not fetch LinkedIn impression or engagement
  metrics.
