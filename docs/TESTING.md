# Testing LINKFLOW

LINKFLOW has four layers of verification:

| Layer | Command | Needs | Proves |
| --- | --- | --- | --- |
| Type + lint | `npm run typecheck`, `npm run lint` | Node | The codebase compiles and follows the lint rules. |
| Unit/integration | `npm run test` | Node | Scheduling math, validation, LinkedIn publishing core. |
| Database (pgTAP) | `npm run test:db` | Supabase CLI + Docker | RLS isolation, engine-field protection, atomic claims, retries. |
| Workflow script | `npm run verify:workflow` | Node + `.env.local` (optional) | The 7-day plan, calendar windows, retry table, and honest mock behaviour. |

Manual verification against a real Supabase project and a real LinkedIn app is described at the end.
**No test in this repository claims that real LinkedIn publishing has happened.** Only an approved
LinkedIn app and a connected account can prove that.

---

## 1. Unit and integration tests (Vitest)

```bash
npm run test           # one shot
npm run test:watch     # watch mode while developing
npm run test:coverage  # v8 coverage report in ./coverage
```

The suite lives in `tests/` and imports the same modules the app and Edge Function use:

| File | Covers |
| --- | --- |
| `tests/scheduling/timezone.test.ts` | Time normalization, IANA validation, date keys, weekday mapping, UTC conversion, DST edges, formatting, `datetime-local` round-trips. |
| `tests/scheduling/slots.test.ts` | Next-N queue slots, past-slot skipping, weekday filters, start-after, horizon guard, 7-day plan, week schedule, upcoming Monday, sort order. |
| `tests/scheduling/calendar.test.ts` | Monday-based week starts, month clamping, 42-day grids, in-period flags, exclusive range ends, view navigation. |
| `tests/validation.test.ts` | Zod schemas for posts, weeks, reschedules, settings and queues; target encoding; code-point character counting. |
| `tests/linkedin/publishing.test.ts` | Author URNs, payloads, image upload order, idempotency header, HTTP error classification, retryability, backoff, token refresh, mock labeling. |
| `tests/linkedin/oauth.test.ts` | Redirect URI building/validation (HTTPS, exact `/api/linkedin/callback`, no query/fragment), authorization URL parameters, token exchange errors, scope fallback. |
| `tests/linkedin/mock-account.test.ts` | Stable mock member IDs, honest labels, account payload, and mock access tokens. |
| `tests/http/origin.test.ts` | Tunnel/proxy-aware origin resolution used for post-OAuth redirects. |
| `tests/config/deployment-config.test.ts` | Every-minute cron SQL, Vault secret names, Edge Function authentication, and env-template secret hygiene. |

### Timezone and DST expectations

These behaviour pins are deliberate. If `date-fns-tz` changes, the tests fail loudly instead of
silently moving posts.

| Case | Expected |
| --- | --- |
| `2026-01-15 10:00` Asia/Kolkata | `2026-01-15T04:30:00.000Z` |
| `2026-01-15 10:00` America/New_York | `2026-01-15T15:00:00.000Z` (`-05:00`) |
| `2026-07-15 10:00` America/New_York | `2026-07-15T14:00:00.000Z` (`-04:00`) |
| `2026-03-08 02:30` America/New_York (non-existent) | `2026-03-08T06:30:00.000Z`, which displays as **01:30** local |
| `2026-11-01 01:30` America/New_York (ambiguous) | `2026-11-01T06:30:00.000Z` (`-05:00`) |

The non-existent-hour case is library-defined: `date-fns-tz` maps it to the pre-transition offset,
so 02:30 becomes 01:30 rather than jumping forward to 03:30. LINKFLOW never silently drops the
post — it stores a real instant — but a user who explicitly schedules inside the missing hour will
see 01:30. This is documented in [publishing-model.md](publishing-model.md#10-timezones).

### LinkedIn publishing core

`supabase/functions/_shared/linkedin.ts` is plain `fetch` + `Uint8Array`. The Edge Function imports
it directly and Vitest imports the same file, so there is no mock reimplementation drifting from
production code. The tests use an injected `fetchImpl`; no test ever calls LinkedIn.

Mock publishing is tested separately and must:

- set `isMock: true`,
- prefix the provider id with `urn:li:share:mock_`,
- return no provider URL,
- never call `fetch`.

---

## 2. Database tests (pgTAP)

```bash
# One-time: start the local stack (requires Docker Desktop)
supabase start

# Reset the local database and apply migrations, then run tests
supabase db reset
npm run test:db
```

Test files live in `supabase/tests/`:

### `001_rls_and_protection_test.sql`

- New auth users automatically get `profiles` and `queue_settings` rows.
- A member sees only their own posts; another member's rows are invisible.
- A member cannot insert a post for someone else, and cannot update another member's post.
- A member cannot create a post already in `processing`, nor transition one to `published`.
- Client writes to `attempt_count`, `provider_post_id`, `is_mock`, and lock fields are neutralised
  by `posts_protect_publishing`, not trusted.

### `002_publishing_engine_test.sql`

- `claim_due_posts` claims only due, retryable posts and skips future and exhausted posts.
- Claims set `status = 'processing'`, increment `attempt_count`, and record the worker.
- A second worker finds nothing to claim (`FOR UPDATE SKIP LOCKED`).
- `mark_post_published` transitions once and refuses replays, leaving the first provider id intact.
- A duplicate `(social_account_id, provider_post_id)` is rejected with SQLSTATE `23505`.
- A paused queue holds overdue posts; resuming makes them claimable again.
- Retryable failures return to `scheduled` with a backoff timestamp and are not re-claimed inside
  the window.
- Terminal failures become `failed` with no retry scheduled.

Tests run inside a transaction and finish with `rollback`, so they are safe to re-run.

> **No Docker?** Skip this layer locally and run the SQL manually in a staging project's SQL editor
> (use a scratch transaction and `rollback`). Do not run destructive test fixtures against
> production.

---

## 3. Workflow verification script

```bash
npm run verify:workflow
```

The script uses `tsx` and relative imports so it runs without the Next.js bundler. It verifies:

1. Seven consecutive days, each at 10:00 Asia/Kolkata, stored as `04:30Z` (or `14:00Z` in New York
   after DST).
2. Calendar grids are Monday-based, 42 days for a month view, with monospaced in-period flags.
3. The full LinkedIn error table (`401`, `403`, `429`, `400`, `409`, `5xx`) maps to the documented
   retry decision.
4. Backoff is `60 → 120 → 240 → 480 → 960 → 1920 → 3600` seconds.
5. Mock publishing is labelled, has a `mock_` id, and makes zero network calls.
6. Empty and oversized posts fail with `invalid_content` before any request.

It also prints an **environment readiness** table (Supabase URL/key, service role, LinkedIn client,
`CRON_SECRET`, migrations, Edge Function). Missing credentials do not fail the run — they are
reported so you know what is left before deploying. The script never claims real publishing was
verified.

Exit code is `1` if any logic check fails, `0` otherwise.

---

## 4. Demo and mock verification (no credentials)

### Demo mode (UI only)

```bash
LINKFLOW_DEMO_MODE=1 npm run dev
```

On PowerShell:

```powershell
$env:LINKFLOW_DEMO_MODE="1"; npm run dev
```

Open <http://localhost:3000>. Demo mode serves read-only fixtures, so every route renders without
Supabase. Mutating actions return a clear "demo mode" error — this is expected and is not a bug.
A banner is shown. Demo mode is hard-disabled when `NODE_ENV=production`.

Check:

- `/dashboard`, `/planner`, `/calendar`, `/queue`, `/posts`, `/accounts`, `/settings`, `/composer`
  all render.
- Light and dark themes both look correct.
- Empty states appear where a filtered list has no rows.
- The calendar month/week/day controls change the URL and the grid.
- Tables and cards reflow at narrow widths.

### Mock publishing (real Supabase, simulated LinkedIn)

Mock mode exercises the real database, real server actions, and the real Edge Function — only the
LinkedIn HTTP calls are skipped. It also lets you connect without a LinkedIn app.

1. Configure `.env.local` with a Supabase project and the server-only
   `SUPABASE_SERVICE_ROLE_KEY`, then apply the migrations.
2. Set `LINKEDIN_MOCK_MODE=true` (never in production) and leave
   `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` empty.
3. Deploy the Edge Function locally or hosted, with `LINKEDIN_MOCK_MODE=true` and no
   `LINKFLOW_ENV=production`.
4. Sign up and open `/accounts` → **Connect mock LinkedIn**. The route creates a connected account
   with a `mock_member_` provider id and a dummy token in Vault, then shows the **Mock** badge and a
   banner explaining that nothing reaches LinkedIn.
5. Open `/planner`, write seven posts, choose 10:00 AM, and click **Schedule all**.
6. Open `/queue` and confirm seven scheduled posts, one per day.
7. Create one post a minute or two out, then invoke the function (or wait for cron):
   `POST /functions/v1/publish-scheduled-posts` with `x-cron-secret`.
8. Confirm the post becomes `published` with `is_mock = true` and a `mock_` provider id, and that
   the UI labels it as simulated.

`npm run doctor` treats the HTTPS redirect and LinkedIn client credentials as warnings while mock
mode is on, because they are not needed for this path. The service role key, migrations, Edge
Function and cron/Vault checks still matter.

Mock results must never be described as real. The Edge Function refuses to start when
`LINKEDIN_MOCK_MODE=true` and `LINKFLOW_ENV=production`.

---

## 5. Type checking, linting, and build

```bash
npm run typecheck
npm run lint
npm run build
```

`next build` is expected to succeed without secrets; configuration is read lazily at runtime. If
the build fails, fix it before deploying. `supabase/functions` is excluded from the Next.js
`tsconfig` because it runs on Deno (npm imports, `Deno.serve`); the shared publishing core is still
typechecked through the Vitest suite. Type-check the Edge Function with the Supabase CLI or
`deno check` when Deno is available.

---

## 6. Manual production verification

After deploying (see [DEPLOYMENT.md](DEPLOYMENT.md)), run this sequence once with a real LinkedIn
account:

1. **Auth** — sign up; the confirmation email lands on `/auth/callback` and redirects to
   `/dashboard`.
2. **Connect** — `/accounts` → *Connect LinkedIn* returns a connected account with the expected
   scopes. Company pages show roles and `can_publish` only for approved admin roles.
3. **Personal post** — publish now from `/composer`; confirm it appears on LinkedIn and shows
   `published` with a working link.
4. **Scheduled post** — schedule two minutes out; it should move
   `scheduled → processing → published` within about a minute.
5. **Audit log** — query `publishing_logs`; one row per attempt, `is_mock = false`.
6. **Pause** — pause the queue; a due post stays `scheduled`; resume and it publishes.
7. **Failure** — revoke the token and retry; the post fails terminally with `invalid_token` and no
   duplicate LinkedIn post appears.
8. **Company page** — repeat step 3 with a page target that has `w_organization_social` and an
   Administrator or Content Admin role.

---

## 7. Continuous integration

A minimal GitHub Actions workflow:

```yaml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npm run verify:workflow
```

Add `supabase/setup-cli@v1` and `supabase db reset` + `npm run test:db` if the runner provides
Docker (GitHub-hosted Ubuntu runners do). Keep database tests off production projects.

---

## 8. What is intentionally not tested

- **Real LinkedIn API calls.** They require an approved app, a real member token, and (for pages)
  Community Management API access. The HTTP contract is tested with injected responses.
- **Supabase hosted behaviour** such as Vault, `pg_cron`, and `pg_net` delivery. These are
  infrastructure; verify them with the queries in [DEPLOYMENT.md](DEPLOYMENT.md#7-operations).
- **Browser end-to-end flows.** There is no Playwright suite yet. The demo and mock walkthroughs
  above cover the main paths manually.
