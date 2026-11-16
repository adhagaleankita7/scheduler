# Deployment guide

This guide takes LINKFLOW from a local checkout to a production deployment on **Vercel** (Next.js)
and **Supabase** (database, auth, storage, Vault, Edge Function, cron).

> Time required: ~30 minutes, mostly waiting for LinkedIn review if you need company pages.

---

## 1. Prerequisites

- A Supabase project (hosted). Record the **project ref**.
- A Vercel account (or any Node host that supports Next.js 15).
- A LinkedIn developer app (see [LINKEDIN_APPROVAL.md](LINKEDIN_APPROVAL.md)).
- The Supabase CLI locally, or access to the Supabase SQL editor.
- A 32+ byte random string for `CRON_SECRET` (`openssl rand -hex 32`).

---

## 2. Supabase project setup

### 2.1 Apply migrations

Fastest path (no CLI needed): open the Supabase SQL editor, paste the contents of
`supabase/linkflow_full_schema.sql`, and run it once. It is every migration concatenated in
filename order, every statement is idempotent, and it is regenerated with `npm run sql:bundle`.

Preferred when you have the CLI:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

Alternative (SQL editor), run in filename order:

1. `supabase/migrations/20260101000100_core_schema.sql`
2. `supabase/migrations/20260101000200_publishing_engine.sql`
3. `supabase/migrations/20260101000300_cron.sql`
4. `supabase/migrations/20261114000000_oauth_profile_metadata.sql`
5. `supabase/migrations/20261114000100_health.sql`

No CLI and no database password? Create a personal access token at
https://supabase.com/dashboard/account/tokens, add `SUPABASE_ACCESS_TOKEN=sbp_…` to `.env.local`,
then run `npm run db:push:api`. It applies the migrations through the Management API and verifies
the tables, functions, policies, storage bucket and cron jobs.

For an end-to-end readiness report (env, tables, RPCs, Edge Function deployment, and — with a service
role key — cron/Vault/storage), run `npm run doctor`.

After applying, verify:

```sql
-- Tables and policies
select tablename, rowsecurity from pg_tables where schemaname = 'public';

-- Engine functions
select proname from pg_proc
where proname in ('claim_due_posts','mark_post_published','mark_post_failed',
                  'get_social_tokens','store_social_tokens','trigger_publish_function');

-- Cron jobs
select jobname, schedule, active from cron.job;
```

You should see `linkflow-publish-every-minute` and `linkflow-cleanup-oauth-state` (both active)
once `pg_cron` is available on your plan.

### 2.2 Storage

The core migration creates the private `post-media` bucket and its policies. Confirm under
**Storage → post-media** that *Public bucket* is **off**.

### 2.3 Auth

**Authentication → URL Configuration**

- Site URL: `https://your-domain.com`
- Redirect URLs:
  - `https://your-domain.com/auth/callback`
  - `http://localhost:3000/auth/callback` (keep for local dev)

**Authentication → Email Templates** — point both templates at the callback route so LINKFLOW can
set the session cookie:

```text
Confirm signup:  {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard
Reset password: {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
```

The callback route accepts both `?code=` (PKCE) and `?token_hash=` + `type` (OTP) links. The
`next` parameter is validated to be a relative path.

**Authentication → Providers** — enable Email. Configure SMTP if you do not want to use the default
rate-limited sender.

### 2.4 Vault secrets for cron

Run in the SQL editor **after** the Edge Function is deployed (step 4):

```sql
do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'linkflow_function_url';
  if v_id is null then
    perform vault.create_secret(
      'https://<project-ref>.supabase.co/functions/v1/publish-scheduled-posts',
      'linkflow_function_url',
      'LINKFLOW publisher Edge Function URL'
    );
  else
    perform vault.update_secret(
      v_id,
      'https://<project-ref>.supabase.co/functions/v1/publish-scheduled-posts',
      'linkflow_function_url',
      'LINKFLOW publisher Edge Function URL'
    );
  end if;

  select id into v_id from vault.secrets where name = 'linkflow_cron_secret';
  if v_id is null then
    perform vault.create_secret(
      '<the exact CRON_SECRET you set on the function>',
      'linkflow_cron_secret',
      'LINKFLOW cron shared secret'
    );
  else
    perform vault.update_secret(
      v_id,
      '<the exact CRON_SECRET you set on the function>',
      'linkflow_cron_secret',
      'LINKFLOW cron shared secret'
    );
  end if;
end
$$;
```

The `do` block is safe to re-run. Plain `vault.create_secret(...)` fails with a duplicate-name error
if the secret already exists; use `vault.update_secret` when rotating.

If either secret is missing, `trigger_publish_function()` raises a warning and returns `null` — the
job runs safely but publishes nothing.

---

## 3. LinkedIn app

Create the app and configure:

- **Redirect URL:** `https://your-domain.com/api/linkedin/callback` — LinkedIn requires HTTPS and
  rejects `http://localhost`. The path must match exactly (no trailing slash, query string, or
  fragment). For local OAuth, run an HTTPS tunnel and set
  `LINKEDIN_REDIRECT_URI=https://<tunnel-host>/api/linkedin/callback`; you can leave
  `NEXT_PUBLIC_APP_URL=http://localhost:3000` for Supabase email links.
- **Products:**
  - *Sign In with LinkedIn using OpenID Connect* → `openid profile email`
  - *Share on LinkedIn* → `w_member_social`
  - *Community Management API* (requires approval) → `w_organization_social r_organization_admin`
    (or `rw_organization_admin`)
- **Scopes:** match `LINKEDIN_SCOPES`. Start with `openid profile email w_member_social`; adding an
  unapproved org scope makes LinkedIn reject the whole authorization with `invalid_scope`.

Full details: [LINKEDIN_APPROVAL.md](LINKEDIN_APPROVAL.md).

---

## 4. Deploy the Edge Function

```bash
supabase functions deploy publish-scheduled-posts --no-verify-jwt

supabase secrets set \
  CRON_SECRET=<long-random-string> \
  LINKEDIN_CLIENT_ID=<client-id> \
  LINKEDIN_CLIENT_SECRET=<client-secret> \
  LINKEDIN_API_VERSION=202610 \
  LINKFLOW_ENV=production
```

Notes:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase.
- `--no-verify-jwt` is required because `pg_net` calls the function with a custom shared secret, not
  a user JWT. The function authorizes the request itself.
- `LINKFLOW_ENV=production` makes the function refuse to run when `LINKEDIN_MOCK_MODE=true`,
  guaranteeing mock results can never be mistaken for real publishing.
- Do **not** set `LINKEDIN_MOCK_MODE` in production.

Smoke test:

```bash
curl -i -X POST \
  "https://<project-ref>.supabase.co/functions/v1/publish-scheduled-posts" \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "content-type: application/json" \
  -d '{}'
```

Expected: `200` with a JSON summary (`claimed`, `published`, `retry`, `failed`, `skipped`).
A missing/wrong secret returns `401`.

---

## 5. Deploy the web app

### Vercel

1. Import the repository.
2. Framework preset: **Next.js**. Build command `npm run build`. Output: default.
3. Add environment variables (Production and Preview):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   # or NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY      # server-only — do not expose
NEXT_PUBLIC_APP_URL=https://your-domain.com
LINKEDIN_CLIENT_ID
LINKEDIN_CLIENT_SECRET
LINKEDIN_SCOPES=openid profile email w_member_social
# After Community Management API approval, append:
# w_organization_social r_organization_admin
LINKEDIN_API_VERSION=202610
CRON_SECRET
# Do NOT set LINKFLOW_DEMO_MODE or LINKEDIN_MOCK_MODE in production.
```

4. Deploy.

The app builds without secrets, but auth and publishing require them at runtime.

### Alternative hosts

Any Node 20+ host works. Ensure:

- `NEXT_PUBLIC_*` variables are present at build time (they are inlined).
- `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are available at runtime only.
- HTTPS is terminated in front of the app; OAuth redirect URLs must match exactly.

---

## 6. Post-deploy verification

Run through this list once:

1. **Sign up / sign in** — email confirmation lands on `/auth/callback` and redirects to
   `/dashboard`.
2. **Connect LinkedIn** — `/accounts` → *Connect LinkedIn* → approve → redirected back with a
   connected account.
3. **Personal post** — write a post in `/composer`, choose *Publish now*, confirm it appears on
   LinkedIn and shows `published` in `/posts`.
4. **Queue** — `/planner` → write two posts → *Schedule all* → both appear in `/queue`.
5. **Automatic publish** — schedule one post 2 minutes out. Within ~1 minute of the due time it should
   move `scheduled → processing → published`.
6. **Audit log** — in SQL:

   ```sql
   select post_id, attempt, outcome, http_status, error_code, created_at
   from public.publishing_logs
   order by created_at desc
   limit 20;
   ```

7. **Pause safety** — pause the queue, let a post become due, confirm it stays `scheduled`; resume
   and confirm it publishes.
8. **Failure path** — temporarily use a revoked token (or set mock mode off with a bad token) and
   confirm the post retries then fails with a clear error and no duplicate LinkedIn post.

---

## 7. Operations

### Health checks

```sql
-- Due posts waiting (should drain every minute)
select count(*) from public.posts
where status = 'scheduled' and scheduled_for <= now();

-- Stuck processing rows (worker crash candidates)
select id, locked_at, locked_by from public.posts
where status = 'processing' and locked_at < now() - interval '15 minutes';

-- Recent failures
select id, last_error_code, last_error, attempt_count
from public.posts where status = 'failed' order by updated_at desc limit 20;

-- Cron execution history (if pg_cron logging is enabled)
select * from cron.job_run_details order by start_time desc limit 20;
```

### Rotating secrets

- **CRON_SECRET:** `supabase secrets set CRON_SECRET=<new>`, then update the
  `linkflow_cron_secret` Vault secret (delete and recreate, or update the existing secret).
- **LinkedIn client secret:** rotate in the LinkedIn portal, update the Vercel env var and the Edge
  Function secret, then reconnect affected accounts if LinkedIn requires it.

### Backups

Supabase takes automatic backups depending on plan. Before risky migrations, run a manual backup or
`pg_dump`. Vault secrets are included in database backups.

### Logs

- Edge Function logs: **Supabase → Edge Functions → publish-scheduled-posts → Logs**.
- `pg_net` responses: `select * from net._http_response order by created desc limit 20;`
- Web app: Vercel logs / your host's logs.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Redirected to `/setup` | Missing `NEXT_PUBLIC_SUPABASE_URL` / anon key | Set env vars and redeploy. |
| `Unauthorized` from the function | `CRON_SECRET` mismatch | Ensure the Vault secret equals the function secret. |
| Cron runs but nothing publishes | Vault secrets missing, or queue paused | Create both Vault secrets; check `queue_settings.is_paused`. |
| Posts stuck in `processing` | Worker crashed mid-flight | The claim function requeues after 15 minutes. Check function logs. |
| `missing_permissions` | Token lacks `w_member_social` / page role | Reconnect and grant scopes; verify page admin role. |
| `invalid_token` | Token expired or revoked | Account shows *Needs reconnect*. Reconnect via `/accounts`. |
| Company page missing | Community Management API not approved | See [LINKEDIN_APPROVAL.md](LINKEDIN_APPROVAL.md). |
| Email link does nothing | Template does not include `token_hash` | Update templates as in step 2.3. |

---

## 9. Security checklist before launch

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is server-only (never `NEXT_PUBLIC_`).
- [ ] `LINKFLOW_DEMO_MODE` and `LINKEDIN_MOCK_MODE` are unset in production.
- [ ] `LINKFLOW_ENV=production` is set on the Edge Function.
- [ ] RLS is enabled on every table in `public`.
- [ ] The `post-media` bucket is private.
- [ ] `CRON_SECRET` is long, random, and not reused.
- [ ] All engine functions are revoked from `anon`/`authenticated` and granted only to
      `service_role`.
- [ ] Auth redirect URLs are restricted to your domains.
- [ ] HTTPS is enforced; cookies are `Secure` in production.
