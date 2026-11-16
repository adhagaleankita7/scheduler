# LINKFLOW go-live runbook

This is the shortest safe path from a working local checkout to real LinkedIn publishing. Follow it
in order. Every step ends with a check so you know it actually worked.

> **Secrets:** never paste client secrets, service-role keys, access tokens or database passwords
> into chat, tickets, screenshots or source control. Add them directly to `.env.local`, the Supabase
> dashboard, the Edge Function secrets, or your hosting provider.

---

## 0. What must exist before you start

| Item | Where it comes from |
| --- | --- |
| Supabase project URL + public key | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (server-only) |
| `SUPABASE_ACCESS_TOKEN` (optional, for scripted SQL) | <https://supabase.com/dashboard/account/tokens> |
| LinkedIn client id + secret | <https://www.linkedin.com/developers/apps> |
| `CRON_SECRET` | Generate once: `openssl rand -hex 32` |
| HTTPS app origin | Vercel domain, custom domain, or an HTTPS tunnel for local OAuth |

`NEXT_PUBLIC_APP_URL` **must be HTTPS** for LinkedIn OAuth. `http://localhost:3000` works for the app
and email links, but LinkedIn rejects it at the consent screen.

### One-command path (steps 1–4)

Once the values above are in `.env.local` (including `SUPABASE_ACCESS_TOKEN`):

```bash
npm run setup:remote
```

It applies the migrations, sets the Edge Function secrets, and stores both Vault secrets — printing
names only, never values. It deliberately does not deploy the function or enable mock mode. Then run
the deploy command it prints (step 2) and `npm run doctor` (step 7).

The manual equivalent is below if you prefer to see each step.

---

## 1. Apply the database schema

Fastest path when you have an access token:

```bash
# .env.local
SUPABASE_ACCESS_TOKEN=sbp_...
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co

npm run db:push:api
```

The script applies every file in `supabase/migrations/` in order through the Management API and
verifies tables, engine functions, policies, the storage bucket and cron jobs. It is safe to re-run.

Without an access token, paste `supabase/linkflow_full_schema.sql` into the Supabase SQL Editor and
run it once. Regenerate that bundle after editing migrations with `npm run sql:bundle`.

**Check:** the script ends with all required rows marked `✔`. Or run:

```sql
select public.linkflow_health();
```

(Requires the service role; the function is not executable by anon/authenticated.)

---

## 2. Deploy the publishing Edge Function

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase functions deploy publish-scheduled-posts --no-verify-jwt
```

`--no-verify-jwt` is required because `pg_net` authenticates with the shared cron secret, not a user
JWT. The function authorizes every request itself.

**Check:** the function appears under Supabase → Edge Functions. Calling it without a secret returns
`401`, not `404`.

---

## 3. Set Edge Function secrets

```bash
npx supabase secrets set \
  CRON_SECRET=<same-value-as-.env.local> \
  LINKEDIN_CLIENT_ID=<client-id> \
  LINKEDIN_CLIENT_SECRET=<client-secret> \
  LINKEDIN_API_VERSION=202610 \
  LINKFLOW_ENV=production
```

Do **not** set `LINKEDIN_MOCK_MODE` in production. `LINKFLOW_ENV=production` makes the function refuse
mock publishing even if the flag is present.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase.

**Check:** `npx supabase secrets list` shows the names (values stay hidden).

---

## 4. Store the cron secrets in Vault

Run in the SQL Editor after the function is deployed:

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
      '<same CRON_SECRET as step 3>',
      'linkflow_cron_secret',
      'LINKFLOW cron shared secret'
    );
  else
    perform vault.update_secret(
      v_id,
      '<same CRON_SECRET as step 3>',
      'linkflow_cron_secret',
      'LINKFLOW cron shared secret'
    );
  end if;
end
$$;

-- Smoke test: returns a pg_net request id, not an error.
select public.trigger_publish_function();
```

**Check:** the smoke test returns a number. If it raises `LINKFLOW cron secrets are not configured`,
the names or values did not land in Vault.

---

## 5. Configure the LinkedIn app

In <https://www.linkedin.com/developers/apps> → your app:

1. **Auth → Redirect URLs:** add exactly
   `https://<your-domain>/api/linkedin/callback`. It must be HTTPS, end with
   `/api/linkedin/callback`, and have no trailing slash, query string, or fragment.
   For local OAuth, run `cloudflared tunnel --url http://localhost:3000` and set
   `LINKEDIN_REDIRECT_URI=https://<tunnel-host>/api/linkedin/callback`. Keep
   `NEXT_PUBLIC_APP_URL=http://localhost:3000` so Supabase email links still work, and add the
   tunnel callback URL to LinkedIn as well. A new tunnel hostname needs a new LinkedIn redirect
   entry.
2. **Products:**
   - *Sign In with LinkedIn using OpenID Connect* → grants `openid profile email`
   - *Share on LinkedIn* → grants `w_member_social`
   - *Community Management API* → request approval only if you need company pages
3. **Scopes in `.env.local` / hosting:**

   ```text
   LINKEDIN_SCOPES=openid profile email w_member_social
   ```

   After Community Management approval, append:

   ```text
   w_organization_social r_organization_admin
   ```

   Adding an unapproved org scope makes LinkedIn reject the **entire** authorization with
   `invalid_scope`, including personal access.

Full detail: [LINKEDIN_APPROVAL.md](LINKEDIN_APPROVAL.md).

---

## 6. Configure the web app environment

Add these to your host (Vercel → Settings → Environment Variables) for Production and Preview:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   # or NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY             # server-only
NEXT_PUBLIC_APP_URL=https://your-domain.com
LINKEDIN_CLIENT_ID
LINKEDIN_CLIENT_SECRET
LINKEDIN_SCOPES=openid profile email w_member_social
LINKEDIN_API_VERSION=202610
CRON_SECRET
# Optional for local OAuth over an HTTPS tunnel:
# LINKEDIN_REDIRECT_URI=https://<tunnel-host>/api/linkedin/callback
```

Never prefix the service-role key or LinkedIn secret with `NEXT_PUBLIC_`.

In Supabase → Authentication → URL Configuration:

- Site URL: `https://your-domain.com`
- Redirect URLs: `https://your-domain.com/auth/callback`

Email templates:

```text
Confirm signup:  {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard
Reset password:  {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
```

---

## 7. Run the readiness doctor

```bash
npm run doctor
```

It checks env presence (never values), the exact HTTPS LinkedIn redirect path, REST tables, engine
RPCs via the PostgREST catalog, Edge Function deployment, and — with a service-role key — cron jobs,
Vault secrets, the private storage bucket and queue depth. In mock mode the LinkedIn OAuth checks are
reported as warnings because mock connect does not need them.

**Check:** `Ready: all required checks passed.` A `WARN` for company-page scopes is fine if you only
need personal publishing.

---

## 8. Prove the workflow

### 8.1 Mock publish (no LinkedIn calls)

1. Set `LINKEDIN_MOCK_MODE=true` locally only and leave the LinkedIn client credentials empty.
2. Sign in, open `/accounts`, and click **Connect mock LinkedIn**.
3. Open `/composer`, write a post, choose **Publish now** (or schedule it).
4. Confirm `/posts` shows `published` with a **Mock** label and `is_mock = true` in the database.
5. Turn mock mode off. Mock results must never be presented as real.

### 8.2 Connect LinkedIn

1. Open `/accounts` → **Connect LinkedIn**.
2. Approve the consent screen.
3. Confirm the account shows **Connected** and, if approved, your company pages.
4. If LinkedIn returns `invalid_scope`, remove the org scopes from `LINKEDIN_SCOPES` and reconnect.

### 8.3 Personal publishing

1. `/composer` → choose your personal profile → **Publish now**.
2. Confirm the post is live on LinkedIn and `/posts` shows a real post URL (no Mock badge).
3. Schedule a post 2–3 minutes out. Within a minute of the due time it should move
   `scheduled → processing → published`.

### 8.4 Company page publishing (only after approval)

1. Reconnect LinkedIn so the token includes `w_organization_social` and `r_organization_admin`.
2. Confirm the page shows **Can publish** on `/accounts`.
3. Publish a test post to the page and confirm it appears on the page.

### 8.5 Failure path

1. Pause the queue in `/queue`, schedule a post 1 minute out, confirm it stays `scheduled`.
2. Resume and confirm it publishes.
3. Revoke the LinkedIn token (or use a bad token in a staging project) and confirm the post retries
   with backoff, then fails with a clear error and no duplicate LinkedIn post.

### 8.6 Audit log

```sql
select post_id, attempt, status, provider, http_status, error_code, message, is_mock, created_at
from public.publishing_logs
order by created_at desc
limit 20;
```

---

## 9. Operations

```sql
-- Due posts waiting (should drain every minute)
select count(*) from public.posts where status = 'scheduled' and scheduled_for <= now();

-- Stuck processing rows
select id, locked_at, locked_by from public.posts
where status = 'processing' and locked_at < now() - interval '15 minutes';

-- Cron history
select * from cron.job_run_details order by start_time desc limit 20;

-- pg_net responses
select * from net._http_response order by created desc limit 20;
```

Rotating `CRON_SECRET`:

1. `npx supabase secrets set CRON_SECRET=<new>`
2. Update the `linkflow_cron_secret` Vault secret with `vault.update_secret`.
3. Run `select public.trigger_publish_function();` and confirm a request id is returned.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `404 Requested function was not found` | Function not deployed | Step 2 |
| Function returns `401` to cron | `CRON_SECRET` ≠ Vault secret | Steps 3 and 4 |
| Cron runs but nothing publishes | Vault secrets missing, queue paused, or no due posts | Check `linkflow_health()`, `/queue` |
| OAuth: `invalid_scope` | Unapproved org scope requested | Use `openid profile email w_member_social` |
| OAuth: `redirect_uri_mismatch` | URL differs from LinkedIn config (host, path, slash) | Register the exact HTTPS callback; the token exchange reuses it |
| "LinkedIn requires an HTTPS redirect URL" | `NEXT_PUBLIC_APP_URL` is `http://` and no override is set | Use an HTTPS domain or `LINKEDIN_REDIRECT_URI` with a tunnel |
| Redirect path error | `LINKEDIN_REDIRECT_URI` points at `/auth/callback` or another route | Point it at `/api/linkedin/callback` |
| OAuth returns to a tunnel that is down | Temporary `trycloudflare` hostname changed or closed | Restart the tunnel and update `LINKEDIN_REDIRECT_URI` + the LinkedIn app |
| "SUPABASE_SERVICE_ROLE_KEY is not configured" on connect | Server env missing the key | Add it server-side and restart; never use `NEXT_PUBLIC_` |
| Company page missing | Community Management not approved or wrong role | See LINKEDIN_APPROVAL.md |
| `permission denied for function get_social_tokens` | Calling it from the browser/anon key | Expected — service role only |
| Posts stuck in `processing` | Worker crashed mid-flight | Claim function requeues after 15 minutes; check function logs |
| Email link does nothing | Template missing `token_hash` | Step 6 |
