-- ============================================================================
-- LINKFLOW · 0002 — Vault token storage + publishing engine primitives
-- ============================================================================

-- Supabase Vault is pre-installed on hosted projects. Guard so local setups
-- that already have it (or omit it) still migrate cleanly.
do $$
begin
  create extension if not exists supabase_vault with schema vault;
exception
  when others then
    raise notice 'supabase_vault extension not available: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Store/refresh LinkedIn tokens in Vault.
-- Tokens are never written to a public table and never returned to browsers.
-- ---------------------------------------------------------------------------
create or replace function public.store_social_tokens(
  p_account_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz,
  p_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_access_name text := 'linkedin_access_token_' || p_account_id::text;
  v_refresh_name text := 'linkedin_refresh_token_' || p_account_id::text;
  v_secret_id uuid;
  v_access_description text := 'LINKFLOW LinkedIn access token for account ' || p_account_id::text;
  v_refresh_description text := 'LINKFLOW LinkedIn refresh token for account ' || p_account_id::text;
begin
  if not exists (select 1 from public.social_accounts where id = p_account_id) then
    raise exception 'Social account % not found', p_account_id using errcode = 'P0002';
  end if;

  if p_access_token is null or char_length(p_access_token) < 10 then
    raise exception 'Access token is missing or malformed' using errcode = '22023';
  end if;

  select id into v_secret_id from vault.secrets where name = v_access_name limit 1;
  if v_secret_id is null then
    perform vault.create_secret(p_access_token, v_access_name, v_access_description);
  else
    perform vault.update_secret(v_secret_id, p_access_token, v_access_name, v_access_description);
  end if;

  if p_refresh_token is not null and char_length(p_refresh_token) >= 10 then
    select id into v_secret_id from vault.secrets where name = v_refresh_name limit 1;
    if v_secret_id is null then
      perform vault.create_secret(p_refresh_token, v_refresh_name, v_refresh_description);
    else
      perform vault.update_secret(v_secret_id, p_refresh_token, v_refresh_name, v_refresh_description);
    end if;
  end if;

  update public.social_accounts
  set token_expires_at = p_access_expires_at,
      refresh_token_expires_at = p_refresh_expires_at,
      scopes = coalesce(p_scopes, scopes),
      status = 'connected',
      last_refreshed_at = now(),
      last_error = null
  where id = p_account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read tokens — service role only (used by the Edge Function).
-- ---------------------------------------------------------------------------
create or replace function public.get_social_tokens(p_account_id uuid)
returns table (
  user_id uuid,
  provider_account_id text,
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  status text,
  scopes text[]
)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_account public.social_accounts;
begin
  select * into v_account from public.social_accounts where id = p_account_id;
  if v_account.id is null then
    return;
  end if;

  return query
  select
    v_account.user_id,
    v_account.provider_account_id,
    (select decrypted_secret from vault.decrypted_secrets
      where name = 'linkedin_access_token_' || p_account_id::text limit 1),
    (select decrypted_secret from vault.decrypted_secrets
      where name = 'linkedin_refresh_token_' || p_account_id::text limit 1),
    v_account.token_expires_at,
    v_account.refresh_token_expires_at,
    v_account.status,
    v_account.scopes;
end;
$$;

-- Update token metadata after a refresh without rewriting the secret.
create or replace function public.touch_social_token_refresh(
  p_account_id uuid,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.social_accounts
  set token_expires_at = p_access_expires_at,
      refresh_token_expires_at = coalesce(p_refresh_expires_at, refresh_token_expires_at),
      last_refreshed_at = now(),
      status = 'connected',
      last_error = null
  where id = p_account_id;
end;
$$;

create or replace function public.delete_social_tokens(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets
  where name in (
    'linkedin_access_token_' || p_account_id::text,
    'linkedin_refresh_token_' || p_account_id::text
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim due posts atomically.
--  * Recovers posts abandoned by a crashed worker (> 15 min).
--  * Uses FOR UPDATE SKIP LOCKED so concurrent workers cannot double-claim.
--  * Retries honour next_retry_at and max_attempts.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_posts(
  p_worker text,
  p_limit integer default 20
)
returns setof public.posts
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Requeue abandoned claims that still have attempts left.
  update public.posts p
  set status = 'scheduled',
      locked_at = null,
      locked_by = null,
      last_error = coalesce(p.last_error, 'The publishing worker stopped before finishing this post.'),
      last_error_code = coalesce(p.last_error_code, 'worker_timeout')
  where p.status = 'processing'
    and p.provider_post_id is null
    and p.locked_at < now() - interval '15 minutes'
    and p.attempt_count < p.max_attempts;

  -- Abandoned claims with no attempts left become terminal failures.
  update public.posts p
  set status = 'failed',
      locked_at = null,
      locked_by = null,
      last_error = coalesce(p.last_error, 'Publishing did not complete after the maximum number of attempts.'),
      last_error_code = coalesce(p.last_error_code, 'worker_timeout')
  where p.status = 'processing'
    and p.locked_at < now() - interval '15 minutes'
    and p.attempt_count >= p.max_attempts;

  return query
  with due as (
    select p.id
    from public.posts p
    where p.status = 'scheduled'
      and p.scheduled_for is not null
      and p.scheduled_for <= now()
      and p.provider_post_id is null
      and (p.next_retry_at is null or p.next_retry_at <= now())
      and p.attempt_count < p.max_attempts
      -- A paused queue holds every due post until it is resumed.
      and not exists (
        select 1 from public.queue_settings qs
        where qs.user_id = p.user_id and qs.is_paused = true
      )
    order by p.scheduled_for asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update of p skip locked
  )
  update public.posts p
  set status = 'processing',
      locked_at = now(),
      locked_by = p_worker,
      attempt_count = p.attempt_count + 1,
      next_retry_at = null
  from due
  where p.id = due.id
  returning p.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirm a successful publish. Exactly-once guard: only a claimed
-- (processing) post can transition, and provider ids are unique per account.
-- ---------------------------------------------------------------------------
create or replace function public.mark_post_published(
  p_post_id uuid,
  p_provider_post_id text,
  p_provider_post_url text default null,
  p_is_mock boolean default false,
  p_http_status integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.posts
  set status = 'published',
      published_at = now(),
      provider_post_id = p_provider_post_id,
      provider_post_url = p_provider_post_url,
      is_mock = coalesce(p_is_mock, false),
      last_http_status = p_http_status,
      locked_at = null,
      locked_by = null,
      next_retry_at = null,
      last_error = null,
      last_error_code = null
  where id = p_post_id
    and status = 'processing';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a failed attempt; schedule a retry with exponential backoff or
-- make the failure terminal.
-- ---------------------------------------------------------------------------
create or replace function public.mark_post_failed(
  p_post_id uuid,
  p_error_code text,
  p_error_message text,
  p_http_status integer default null,
  p_retryable boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts;
  v_retry boolean;
  v_delay_seconds integer;
begin
  select * into v_post from public.posts where id = p_post_id for update;
  if v_post.id is null then
    return 'missing';
  end if;
  if v_post.status <> 'processing' then
    return v_post.status;
  end if;

  v_retry := coalesce(p_retryable, false) and v_post.attempt_count < v_post.max_attempts;

  if v_retry then
    v_delay_seconds := least(
      (power(2, greatest(v_post.attempt_count - 1, 0)) * 60)::integer,
      3600
    );

    update public.posts
    set status = 'scheduled',
        next_retry_at = now() + make_interval(secs => v_delay_seconds),
        last_error = p_error_message,
        last_error_code = p_error_code,
        last_http_status = p_http_status,
        locked_at = null,
        locked_by = null
    where id = p_post_id;

    return 'scheduled';
  end if;

  update public.posts
  set status = 'failed',
      next_retry_at = null,
      last_error = p_error_message,
      last_error_code = p_error_code,
      last_http_status = p_http_status,
      locked_at = null,
      locked_by = null
  where id = p_post_id;

  return 'failed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron bridge: reads function URL + secret from Vault and invokes the Edge
-- Function with pg_net. No-ops (with a warning) until setup is complete.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_publish_function()
returns bigint
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  if to_regnamespace('net') is null then
    raise warning 'pg_net is not installed; cannot invoke publish-scheduled-posts';
    return null;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'linkflow_function_url' limit 1;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'linkflow_cron_secret' limit 1;

  if v_url is null or v_secret is null then
    raise warning 'LINKFLOW cron secrets are not configured in Vault (linkflow_function_url / linkflow_cron_secret)';
    return null;
  end if;

  execute format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 30000)',
    v_url,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    )::text,
    '{}'::jsonb::text
  ) into v_request_id;

  return v_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down engine functions: Edge Function service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.store_social_tokens(uuid, text, text, timestamptz, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.get_social_tokens(uuid) from public, anon, authenticated;
revoke all on function public.touch_social_token_refresh(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.delete_social_tokens(uuid) from public, anon, authenticated;
revoke all on function public.claim_due_posts(text, integer) from public, anon, authenticated;
revoke all on function public.mark_post_published(uuid, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.mark_post_failed(uuid, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.trigger_publish_function() from public, anon, authenticated;

grant execute on function public.store_social_tokens(uuid, text, text, timestamptz, timestamptz, text[]) to service_role;
grant execute on function public.get_social_tokens(uuid) to service_role;
grant execute on function public.touch_social_token_refresh(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.delete_social_tokens(uuid) to service_role;
grant execute on function public.claim_due_posts(text, integer) to service_role;
grant execute on function public.mark_post_published(uuid, text, text, boolean, integer) to service_role;
grant execute on function public.mark_post_failed(uuid, text, text, integer, boolean) to service_role;
grant execute on function public.trigger_publish_function() to service_role;
