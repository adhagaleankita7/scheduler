-- ===========================================================================
-- LINKFLOW - full schema bundle
-- ===========================================================================
-- GENERATED FILE. Do not edit by hand.
-- Source: supabase/migrations/ (8 files, in filename order)
-- Regenerate: npm run sql:bundle
--
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Every statement is idempotent, so re-running is safe.
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 20260101000100_core_schema.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- LINKFLOW Â· 0001 â€” Core schema, RLS, storage
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  headline text,
  avatar_url text,
  timezone text not null default 'Asia/Kolkata',
  default_posting_time time not null default '10:00',
  default_posting_days smallint[] not null default '{1,2,3,4,5,6,7}',
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_timezone_len check (char_length(timezone) between 1 and 64),
  constraint profiles_posting_days_valid check (
    default_posting_days <@ array[1,2,3,4,5,6,7]::smallint[]
  )
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- social_accounts â€” tokens live in Vault, never in this table
-- ---------------------------------------------------------------------------
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'linkedin' check (provider = 'linkedin'),
  provider_account_id text not null,
  display_name text not null default 'LinkedIn member',
  avatar_url text,
  email text,
  scopes text[] not null default '{}',
  status text not null default 'connected'
    check (status in ('connected', 'needs_reconnect', 'disconnected')),
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_accounts_unique_member unique (user_id, provider, provider_account_id)
);

create index if not exists social_accounts_user_idx on public.social_accounts (user_id);

drop trigger if exists social_accounts_set_updated_at on public.social_accounts;
create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- social_pages â€” authorized LinkedIn company pages
-- ---------------------------------------------------------------------------
create table if not exists public.social_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  provider_page_id text not null,
  name text not null,
  vanity_name text,
  logo_url text,
  page_type text not null default 'organization',
  role text,
  can_publish boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_pages_unique_page unique (user_id, provider_page_id)
);

create index if not exists social_pages_account_idx on public.social_pages (social_account_id);
create index if not exists social_pages_user_idx on public.social_pages (user_id);

drop trigger if exists social_pages_set_updated_at on public.social_pages;
create trigger social_pages_set_updated_at
  before update on public.social_pages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- publishing_schedules â€” a named weekly or 30-day plan
-- ---------------------------------------------------------------------------
create table if not exists public.publishing_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Weekly LinkedIn plan',
  timezone text not null default 'Asia/Kolkata',
  start_date date not null default current_date,
  end_date date,
  target_type text not null default 'member' check (target_type in ('member', 'organization')),
  social_account_id uuid references public.social_accounts (id) on delete set null,
  social_page_id uuid references public.social_pages (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publishing_schedules_user_idx
  on public.publishing_schedules (user_id, start_date desc);

drop trigger if exists publishing_schedules_set_updated_at on public.publishing_schedules;
create trigger publishing_schedules_set_updated_at
  before update on public.publishing_schedules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  social_account_id uuid references public.social_accounts (id) on delete set null,
  social_page_id uuid references public.social_pages (id) on delete set null,
  schedule_id uuid references public.publishing_schedules (id) on delete set null,
  target_type text not null default 'member' check (target_type in ('member', 'organization')),
  content text not null,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'processing', 'published', 'failed', 'cancelled')),
  scheduled_for timestamptz,
  published_at timestamptz,
  provider_post_id text,
  provider_post_url text,
  is_mock boolean not null default false,
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  next_retry_at timestamptz,
  last_error text,
  last_error_code text,
  last_http_status integer,
  locked_at timestamptz,
  locked_by text,
  queue_position integer,
  idempotency_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_content_length check (char_length(btrim(content)) between 1 and 3000),
  constraint posts_target_consistency check (
    (target_type = 'member' and social_page_id is null)
    or (target_type = 'organization' and social_page_id is not null)
  ),
  constraint posts_scheduled_requires_time check (
    status not in ('scheduled', 'processing') or scheduled_for is not null
  ),
  constraint posts_idempotency_unique unique (idempotency_key)
);

-- The hard database guard against publishing the same LinkedIn post twice.
create unique index if not exists posts_provider_post_unique
  on public.posts (social_account_id, provider_post_id)
  where provider_post_id is not null;

create index if not exists posts_user_status_idx on public.posts (user_id, status);
create index if not exists posts_due_idx on public.posts (status, scheduled_for)
  where status = 'scheduled';
create index if not exists posts_user_scheduled_idx on public.posts (user_id, scheduled_for);
create index if not exists posts_user_created_idx on public.posts (user_id, created_at desc);
create index if not exists posts_schedule_idx on public.posts (schedule_id) where schedule_id is not null;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- Protect engine-owned columns from direct client writes.
create or replace function public.protect_post_publishing_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.provider_post_id := null;
      new.provider_post_url := null;
      new.published_at := null;
      new.is_mock := false;
      new.attempt_count := 0;
      new.next_retry_at := null;
      new.locked_at := null;
      new.locked_by := null;
      new.last_error := null;
      new.last_error_code := null;
      new.last_http_status := null;
      if new.status in ('processing', 'published') then
        raise exception 'Posts cannot be created with status %', new.status
          using errcode = '42501';
      end if;
    else
      if (old.status in ('processing', 'published') and new.status is distinct from old.status) then
        raise exception 'Only the publishing engine can change a post that is %', old.status
          using errcode = '42501';
      end if;
      if new.status is distinct from old.status
         and new.status in ('processing', 'published') then
        raise exception 'Only the publishing engine can transition a post to %', new.status
          using errcode = '42501';
      end if;

      -- Result fields always belong to the engine.
      new.provider_post_id := old.provider_post_id;
      new.provider_post_url := old.provider_post_url;
      new.published_at := old.published_at;
      new.is_mock := old.is_mock;
      new.idempotency_key := old.idempotency_key;

      if old.status in ('failed', 'cancelled') and new.status in ('draft', 'scheduled') then
        -- Re-queueing or re-saving a finished attempt starts a clean slate.
        -- Without this a post that exhausted max_attempts could never publish.
        new.attempt_count := 0;
        new.next_retry_at := null;
        new.locked_at := null;
        new.locked_by := null;
        new.last_error := null;
        new.last_error_code := null;
        new.last_http_status := null;
      else
        new.attempt_count := old.attempt_count;
        new.next_retry_at := old.next_retry_at;
        new.locked_at := old.locked_at;
        new.locked_by := old.locked_by;
        new.last_error := old.last_error;
        new.last_error_code := old.last_error_code;
        new.last_http_status := old.last_http_status;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_protect_publishing on public.posts;
create trigger posts_protect_publishing
  before insert or update on public.posts
  for each row execute function public.protect_post_publishing_fields();

-- ---------------------------------------------------------------------------
-- post_media
-- ---------------------------------------------------------------------------
create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  alt_text text,
  size_bytes integer,
  created_at timestamptz not null default now(),
  constraint post_media_one_per_post unique (post_id)
);

create index if not exists post_media_user_idx on public.post_media (user_id);

-- ---------------------------------------------------------------------------
-- publishing_logs
-- ---------------------------------------------------------------------------
create table if not exists public.publishing_logs (
  id bigint generated always as identity primary key,
  post_id uuid references public.posts (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  attempt smallint,
  status text not null check (status in ('started', 'success', 'failure', 'retry_scheduled', 'skipped')),
  provider text not null default 'linkedin' check (provider in ('linkedin', 'mock')),
  http_status integer,
  provider_post_id text,
  error_code text,
  message text,
  is_mock boolean not null default false,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists publishing_logs_user_idx
  on public.publishing_logs (user_id, created_at desc);
create index if not exists publishing_logs_post_idx
  on public.publishing_logs (post_id, created_at desc);

-- ---------------------------------------------------------------------------
-- queue_settings
-- ---------------------------------------------------------------------------
create table if not exists public.queue_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  posting_days smallint[] not null default '{1,2,3,4,5,6,7}',
  posting_times time[] not null default '{10:00}',
  is_paused boolean not null default false,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint queue_days_valid check (posting_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint queue_days_not_empty check (cardinality(posting_days) > 0),
  constraint queue_times_not_empty check (cardinality(posting_times) > 0)
);

drop trigger if exists queue_settings_set_updated_at on public.queue_settings;
create trigger queue_settings_set_updated_at
  before update on public.queue_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New user bootstrap
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;

  insert into public.queue_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Verify that a post/schedule target belongs to the signed-in user before RLS
-- lets a row be written. Runs as the function owner so the existence checks are
-- not themselves filtered by the caller's RLS.
create or replace function public.owns_post_target(p_account_id uuid, p_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (p_account_id is null or exists (
      select 1 from public.social_accounts a
      where a.id = p_account_id
        and a.user_id = (select auth.uid())
    ))
    and (p_page_id is null or exists (
      select 1 from public.social_pages p
      where p.id = p_page_id
        and p.user_id = (select auth.uid())
        and (p_account_id is null or p.social_account_id = p_account_id)
    ));
$$;

revoke all on function public.owns_post_target(uuid, uuid) from public, anon;
grant execute on function public.owns_post_target(uuid, uuid) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.social_accounts enable row level security;
alter table public.social_pages enable row level security;
alter table public.publishing_schedules enable row level security;
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.publishing_logs enable row level security;
alter table public.queue_settings enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- social accounts
drop policy if exists "social_accounts_select_own" on public.social_accounts;
create policy "social_accounts_select_own" on public.social_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "social_accounts_delete_own" on public.social_accounts;
create policy "social_accounts_delete_own" on public.social_accounts
  for delete to authenticated using ((select auth.uid()) = user_id);

-- social pages
drop policy if exists "social_pages_select_own" on public.social_pages;
create policy "social_pages_select_own" on public.social_pages
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "social_pages_delete_own" on public.social_pages;
create policy "social_pages_delete_own" on public.social_pages
  for delete to authenticated using ((select auth.uid()) = user_id);

-- publishing schedules
drop policy if exists "publishing_schedules_all_own" on public.publishing_schedules;
create policy "publishing_schedules_all_own" on public.publishing_schedules
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and public.owns_post_target(social_account_id, social_page_id)
  );

-- posts
drop policy if exists "posts_select_own" on public.posts;
create policy "posts_select_own" on public.posts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.owns_post_target(social_account_id, social_page_id)
  );
drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and public.owns_post_target(social_account_id, social_page_id)
  );
drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts
  for delete to authenticated using ((select auth.uid()) = user_id);

-- post media
drop policy if exists "post_media_all_own" on public.post_media;
create policy "post_media_all_own" on public.post_media
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- publishing logs (read-only for owners; writes only by the engine)
drop policy if exists "publishing_logs_select_own" on public.publishing_logs;
create policy "publishing_logs_select_own" on public.publishing_logs
  for select to authenticated using ((select auth.uid()) = user_id);

-- queue settings
drop policy if exists "queue_settings_all_own" on public.queue_settings;
create policy "queue_settings_all_own" on public.queue_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Table privileges â€” authenticated users may not write engine tables directly
-- ---------------------------------------------------------------------------
-- Explicit grants so the app does not depend on a project's default privileges.
-- RLS still restricts every row to its owner. `anon` only needs to probe
-- `profiles` so /setup can detect that the schema exists.
grant select on public.profiles to anon;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant select, insert, update, delete on public.post_media to authenticated;
grant select, insert, update, delete on public.publishing_schedules to authenticated;
grant select, insert, update, delete on public.queue_settings to authenticated;

revoke all on public.publishing_logs from anon, authenticated;
grant select on public.publishing_logs to authenticated;

revoke all on public.social_accounts from anon, authenticated;
grant select (id, user_id, provider, provider_account_id, display_name, avatar_url, email,
              scopes, status, token_expires_at, refresh_token_expires_at, last_refreshed_at,
              last_error, connected_at, created_at, updated_at)
  on public.social_accounts to authenticated;
grant delete on public.social_accounts to authenticated;

revoke all on public.social_pages from anon, authenticated;
grant select, delete on public.social_pages to authenticated;

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for post images
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post_media_objects_select_own" on storage.objects;
create policy "post_media_objects_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "post_media_objects_insert_own" on storage.objects;
create policy "post_media_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "post_media_objects_update_own" on storage.objects;
create policy "post_media_objects_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "post_media_objects_delete_own" on storage.objects;
create policy "post_media_objects_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- OAuth state (server-only; no client policies)
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  state text not null unique,
  code_verifier text,
  return_to text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create index if not exists oauth_states_expires_idx on public.oauth_states (expires_at);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 20260101000200_publishing_engine.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- LINKFLOW Â· 0002 â€” Vault token storage + publishing engine primitives
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
-- Read tokens â€” service role only (used by the Edge Function).
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

-- ---------------------------------------------------------------------------
-- 20260101000300_cron.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- LINKFLOW Â· 0003 â€” pg_cron + pg_net every-minute publisher
-- ============================================================================
-- Before enabling the schedule, store these two secrets in Vault:
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/publish-scheduled-posts',
--     'linkflow_function_url',
--     'LINKFLOW publisher Edge Function URL'
--   );
--   select vault.create_secret('<the same CRON_SECRET you set on the function>',
--     'linkflow_cron_secret',
--     'LINKFLOW cron shared secret'
--   );
-- Until then the job runs but does nothing (no failed HTTP requests).
-- ============================================================================

do $$
begin
  -- pg_cron is not relocatable: its control file pins it to pg_catalog, so
  -- asking for `extensions` makes CREATE EXTENSION fail outright.
  create extension if not exists pg_cron with schema pg_catalog;
exception when others then
  raise notice 'pg_cron extension unavailable: %', sqlerrm;
end;
$$;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net extension unavailable: %', sqlerrm;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'linkflow-publish-every-minute') then
    perform cron.unschedule('linkflow-publish-every-minute');
  end if;

  perform cron.schedule(
    'linkflow-publish-every-minute',
    '* * * * *',
    'select public.trigger_publish_function();'
  );
exception when others then
  raise notice 'Could not register LINKFLOW cron job (expected on local stacks without pg_cron): %', sqlerrm;
end;
$$;

-- Housekeeping: expire abandoned OAuth state rows daily.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'linkflow-cleanup-oauth-state') then
    perform cron.unschedule('linkflow-cleanup-oauth-state');
  end if;
  perform cron.schedule(
    'linkflow-cleanup-oauth-state',
    '17 * * * *',
    'delete from public.oauth_states where expires_at < now() - interval ''1 day'';'
  );
exception when others then
  raise notice 'Could not register OAuth cleanup job: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 20261114000000_oauth_profile_metadata.sql
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Social sign-in (Google / GitHub / LinkedIn OIDC) profile bootstrap
--
-- The original trigger only copied `full_name`. OAuth providers also expose an
-- avatar (`avatar_url` for Google, `picture` for most OIDC providers) and some
-- only send `name`, so capture those too. Safe to re-run.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do nothing;

  insert into public.queue_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles created before OAuth metadata was captured. Only fills
-- columns that are still empty, so user-edited values are never overwritten.
update public.profiles as p
set
  full_name = coalesce(
    nullif(p.full_name, ''),
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), '')
  ),
  avatar_url = coalesce(
    nullif(p.avatar_url, ''),
    nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(u.raw_user_meta_data ->> 'picture', '')
  )
from auth.users as u
where u.id = p.id
  and (p.full_name is null or p.avatar_url is null);

-- ---------------------------------------------------------------------------
-- 20261114000100_health.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- LINKFLOW Â· 0005 â€” Service-role readiness report
-- ============================================================================
-- Exposes only booleans/counts. Secret *values* are never read or returned.
-- Used by `npm run doctor` and safe to call from any trusted server process.
-- ============================================================================

create or replace function public.linkflow_health()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, cron, storage
as $$
declare
  v_tables integer := 0;
  v_functions integer := 0;
  v_policies integer := 0;
  v_bucket integer := 0;
  v_cron_jobs integer := 0;
  v_cron_secrets integer := 0;
  v_pg_cron boolean := false;
  v_pg_net boolean := false;
  v_vault boolean := false;
  v_due integer := 0;
  v_processing integer := 0;
  v_failed integer := 0;
begin
  select count(*) into v_tables
  from pg_tables
  where schemaname = 'public'
    and tablename = any (array[
      'profiles', 'social_accounts', 'social_pages', 'posts', 'post_media',
      'publishing_logs', 'queue_settings', 'publishing_schedules', 'oauth_states'
    ]);

  select count(*) into v_functions
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = any (array[
      'claim_due_posts', 'mark_post_published', 'mark_post_failed',
      'get_social_tokens', 'store_social_tokens', 'touch_social_token_refresh',
      'delete_social_tokens', 'trigger_publish_function'
    ]);

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public';

  v_pg_cron := to_regclass('cron.job') is not null;
  if v_pg_cron then
    select count(*) into v_cron_jobs from cron.job where jobname like 'linkflow-%';
  end if;

  v_pg_net := to_regclass('net._http_response') is not null;

  v_vault := to_regclass('vault.secrets') is not null;
  if v_vault then
    select count(*) into v_cron_secrets
    from vault.secrets
    where name in ('linkflow_function_url', 'linkflow_cron_secret');
  end if;

  if to_regclass('storage.buckets') is not null then
    select count(*) into v_bucket
    from storage.buckets
    where id = 'post-media' and public = false;
  end if;

  if to_regclass('public.posts') is not null then
    select
      count(*) filter (where status = 'scheduled' and scheduled_for <= now()),
      count(*) filter (where status = 'processing'),
      count(*) filter (where status = 'failed')
    into v_due, v_processing, v_failed
    from public.posts;
  end if;

  return jsonb_build_object(
    'checked_at', now(),
    'tables', v_tables,
    'tables_expected', 9,
    'engine_functions', v_functions,
    'engine_functions_expected', 8,
    'policies', v_policies,
    'storage_bucket_private', v_bucket = 1,
    'pg_cron', v_pg_cron,
    'pg_net', v_pg_net,
    'cron_jobs', v_cron_jobs,
    'cron_jobs_expected', 2,
    'vault', v_vault,
    'cron_secrets_present', v_cron_secrets,
    'due_posts', v_due,
    'processing_posts', v_processing,
    'failed_posts', v_failed
  );
end;
$$;

revoke all on function public.linkflow_health() from public, anon, authenticated;
grant execute on function public.linkflow_health() to service_role;

-- ---------------------------------------------------------------------------
-- 20261115000000_oauth_state_scopes.sql
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- OAuth state: remember which scopes an authorization attempt requested
-- ---------------------------------------------------------------------------
-- Company-page scopes (w_organization_social / r_organization_admin) are gated
-- behind LinkedIn's Community Management API approval. While that approval is
-- pending, LinkedIn rejects the *entire* authorization with `invalid_scope`,
-- so LINKFLOW retries the connect flow with personal scopes only.
--
-- The callback must know which list the returned code was issued for: resolving
-- a token that omits `scope` against the configured org-scope list would wrongly
-- mark page publishing as available. The column is nullable so existing rows and
-- any older client keep working (the callback then falls back to env scopes).
alter table public.oauth_states
  add column if not exists scopes text;

comment on column public.oauth_states.scopes is
  'Space-separated scopes requested for this authorization attempt (personal-only after a fallback retry).';

-- ---------------------------------------------------------------------------
-- 20261116000000_facebook_provider.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- LINKFLOW Â· Facebook Pages provider
-- ============================================================================
-- Adds Facebook as a second publishing provider next to LinkedIn.
--
-- Design notes:
--   * Meta's Graph API only allows automated posting to Facebook *Pages*
--     (`pages_manage_posts`). Personal profiles are not supported, so a
--     Facebook target is always a page (`target_type = 'organization'`).
--   * Tokens still live in Supabase Vault. Secret names gained a provider
--     prefix, so existing LinkedIn secrets keep the exact same names.
--   * Every statement is idempotent and safe to re-run.
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- social_accounts: allow the facebook provider
-- ---------------------------------------------------------------------------
alter table public.social_accounts
  drop constraint if exists social_accounts_provider_check;

alter table public.social_accounts
  add constraint social_accounts_provider_check
  check (provider in ('linkedin', 'facebook'));

-- ---------------------------------------------------------------------------
-- social_pages: remember which provider owns a page
-- ---------------------------------------------------------------------------
-- LinkedIn organization ids and Facebook page ids are both numeric strings, so
-- the old (user_id, provider_page_id) uniqueness could collide across
-- providers. Scope it per provider instead.
alter table public.social_pages
  add column if not exists provider text not null default 'linkedin';

alter table public.social_pages
  drop constraint if exists social_pages_unique_page;

create unique index if not exists social_pages_provider_page_unique
  on public.social_pages (user_id, provider, provider_page_id);

alter table public.social_pages
  drop constraint if exists social_pages_provider_check;

alter table public.social_pages
  add constraint social_pages_provider_check
  check (provider in ('linkedin', 'facebook'));

-- Backfill provider from the owning account for rows created before this
-- migration. Existing rows are all LinkedIn today.
update public.social_pages as p
set provider = a.provider
from public.social_accounts as a
where p.social_account_id = a.id
  and p.provider is distinct from a.provider;

-- ---------------------------------------------------------------------------
-- publishing_logs: allow facebook
-- ---------------------------------------------------------------------------
alter table public.publishing_logs
  drop constraint if exists publishing_logs_provider_check;

alter table public.publishing_logs
  add constraint publishing_logs_provider_check
  check (provider in ('linkedin', 'facebook', 'mock'));

-- ---------------------------------------------------------------------------
-- oauth_states: remember which provider an authorization attempt belongs to
-- ---------------------------------------------------------------------------
alter table public.oauth_states
  add column if not exists provider text not null default 'linkedin';

alter table public.oauth_states
  drop constraint if exists oauth_states_provider_check;

alter table public.oauth_states
  add constraint oauth_states_provider_check
  check (provider in ('linkedin', 'facebook'));

-- ---------------------------------------------------------------------------
-- Vault token RPCs: provider-aware secret names
-- ---------------------------------------------------------------------------
-- Existing LinkedIn accounts keep the `linkedin_*` names, so no secret has to
-- be migrated. Facebook accounts store `facebook_access_token_<account-id>`.
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
  v_provider text;
  v_access_name text;
  v_refresh_name text;
  v_secret_id uuid;
  v_access_description text;
  v_refresh_description text;
begin
  select provider into v_provider
  from public.social_accounts
  where id = p_account_id;

  if v_provider is null then
    raise exception 'Social account % not found', p_account_id using errcode = 'P0002';
  end if;

  if p_access_token is null or char_length(p_access_token) < 10 then
    raise exception 'Access token is missing or malformed' using errcode = '22023';
  end if;

  v_access_name := v_provider || '_access_token_' || p_account_id::text;
  v_refresh_name := v_provider || '_refresh_token_' || p_account_id::text;
  v_access_description := 'LINKFLOW ' || v_provider || ' access token for account ' || p_account_id::text;
  v_refresh_description := 'LINKFLOW ' || v_provider || ' refresh token for account ' || p_account_id::text;

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

-- The return type gained a `provider` column, so the old function must be
-- dropped before it can be recreated.
drop function if exists public.get_social_tokens(uuid);

create function public.get_social_tokens(p_account_id uuid)
returns table (
  user_id uuid,
  provider text,
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
  v_prefix text;
begin
  select * into v_account from public.social_accounts where id = p_account_id;
  if v_account.id is null then
    return;
  end if;

  v_prefix := v_account.provider || '_';

  return query
  select
    v_account.user_id,
    v_account.provider,
    v_account.provider_account_id,
    (select decrypted_secret from vault.decrypted_secrets
      where name = v_prefix || 'access_token_' || p_account_id::text limit 1),
    (select decrypted_secret from vault.decrypted_secrets
      where name = v_prefix || 'refresh_token_' || p_account_id::text limit 1),
    v_account.token_expires_at,
    v_account.refresh_token_expires_at,
    v_account.status,
    v_account.scopes;
end;
$$;

create or replace function public.delete_social_tokens(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_provider text;
begin
  select provider into v_provider
  from public.social_accounts
  where id = p_account_id;

  if v_provider is null then
    return;
  end if;

  delete from vault.secrets
  where name in (
    v_provider || '_access_token_' || p_account_id::text,
    v_provider || '_refresh_token_' || p_account_id::text
  );
end;
$$;

revoke all on function public.store_social_tokens(uuid, text, text, timestamptz, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.get_social_tokens(uuid) from public, anon, authenticated;
revoke all on function public.delete_social_tokens(uuid) from public, anon, authenticated;

grant execute on function public.store_social_tokens(uuid, text, text, timestamptz, timestamptz, text[]) to service_role;
grant execute on function public.get_social_tokens(uuid) to service_role;
grant execute on function public.delete_social_tokens(uuid) to service_role;

comment on column public.social_pages.provider is
  'Publishing provider that owns this page (linkedin organization or facebook page).';
comment on column public.oauth_states.provider is
  'Provider this authorization attempt belongs to.';

-- ---------------------------------------------------------------------------
-- 20261119000000_post_engagement.sql
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Post engagement (likes, comments, shares)
--
-- Counts are written only by the publishing worker via the service role. The
-- protect_post_publishing_fields trigger keeps them engine-owned, exactly like
-- provider_post_id / published_at, so a client cannot fake its own metrics.
-- ---------------------------------------------------------------------------

alter table public.posts
  add column if not exists like_count integer not null default 0,
  add column if not exists comment_count integer not null default 0,
  add column if not exists share_count integer not null default 0,
  add column if not exists engagement_synced_at timestamptz,
  add column if not exists engagement_error text;

create or replace function public.protect_post_publishing_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.provider_post_id := null;
      new.provider_post_url := null;
      new.published_at := null;
      new.is_mock := false;
      new.attempt_count := 0;
      new.next_retry_at := null;
      new.locked_at := null;
      new.locked_by := null;
      new.last_error := null;
      new.last_error_code := null;
      new.last_http_status := null;
      new.like_count := 0;
      new.comment_count := 0;
      new.share_count := 0;
      new.engagement_synced_at := null;
      new.engagement_error := null;
      if new.status in ('processing', 'published') then
        raise exception 'Posts cannot be created with status %', new.status
          using errcode = '42501';
      end if;
    else
      if (old.status in ('processing', 'published') and new.status is distinct from old.status) then
        raise exception 'Only the publishing engine can change a post that is %', old.status
          using errcode = '42501';
      end if;
      if new.status is distinct from old.status
         and new.status in ('processing', 'published') then
        raise exception 'Only the publishing engine can transition a post to %', new.status
          using errcode = '42501';
      end if;

      -- Result fields always belong to the engine.
      new.provider_post_id := old.provider_post_id;
      new.provider_post_url := old.provider_post_url;
      new.published_at := old.published_at;
      new.is_mock := old.is_mock;
      new.idempotency_key := old.idempotency_key;
      new.like_count := old.like_count;
      new.comment_count := old.comment_count;
      new.share_count := old.share_count;
      new.engagement_synced_at := old.engagement_synced_at;
      new.engagement_error := old.engagement_error;

      if old.status in ('failed', 'cancelled') and new.status in ('draft', 'scheduled') then
        -- Re-queueing or re-saving a finished attempt starts a clean slate.
        -- Without this a post that exhausted max_attempts could never publish.
        new.attempt_count := 0;
        new.next_retry_at := null;
        new.locked_at := null;
        new.locked_by := null;
        new.last_error := null;
        new.last_error_code := null;
        new.last_http_status := null;
      else
        new.attempt_count := old.attempt_count;
        new.next_retry_at := old.next_retry_at;
        new.locked_at := old.locked_at;
        new.locked_by := old.locked_by;
        new.last_error := old.last_error;
        new.last_error_code := old.last_error_code;
        new.last_http_status := old.last_http_status;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create index if not exists posts_engagement_sync_idx
  on public.posts (engagement_synced_at asc nulls first)
  where status = 'published' and is_mock = false;

-- ============================================================================
-- Workspaces and collaborators (consolidated)
-- ============================================================================
-- Mirrors supabase/migrations/20261119000100_workspaces.sql.
-- ============================================================================
-- LINKFLOW Â· Workspaces and collaborators
-- ============================================================================
-- Turns the single-user schema into a shared workspace:
--   * every user owns a workspace and can be invited to other workspaces
--   * all accounts, plans, posts, media and queue settings belong to a workspace
--   * members see exactly the same data as the owner and editors can publish
--   * the owner manages members; members can switch between workspaces they joined
--
-- Every statement is idempotent and safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Workspace tables
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'My workspace',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_len check (char_length(btrim(name)) between 1 and 80)
);

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor'
    check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id, created_at);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role text not null default 'editor'
    check (role in ('editor', 'viewer')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create unique index if not exists workspace_invites_pending_unique
  on public.workspace_invites (workspace_id, lower(email))
  where accepted_at is null;

create index if not exists workspace_invites_email_idx
  on public.workspace_invites (lower(email))
  where accepted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Profiles gain an email and an active workspace
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists email text;

alter table public.profiles
  add column if not exists active_workspace_id uuid
  references public.workspaces (id) on delete set null;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is distinct from u.email;

-- ---------------------------------------------------------------------------
-- 3. Backfill one owned workspace per existing user
-- ---------------------------------------------------------------------------
insert into public.workspaces (owner_id, name)
select
  u.id,
  coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'My'
  ) || '''s workspace'
from auth.users u
left join public.profiles p on p.id = u.id
where not exists (
  select 1 from public.workspaces w where w.owner_id = u.id
);

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.owner_id, 'owner'
from public.workspaces w
on conflict (workspace_id, user_id) do update set role = 'owner';

update public.profiles p
set active_workspace_id = w.id
from public.workspaces w
where w.owner_id = p.id
  and p.active_workspace_id is null;

-- ---------------------------------------------------------------------------
-- 4. Add workspace_id to every content table and backfill it
-- ---------------------------------------------------------------------------
alter table public.social_accounts
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.social_pages
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.publishing_schedules
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.posts
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.post_media
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.publishing_logs
  add column if not exists workspace_id uuid references public.workspaces (id) on delete set null;
alter table public.queue_settings
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

-- OAuth started in the active workspace, so the callback can attach the new
-- account and pages to that same workspace even if the user switches later.
alter table public.oauth_states
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

update public.social_accounts t
set workspace_id = w.id
from public.workspaces w
where w.owner_id = t.user_id and t.workspace_id is null;

update public.social_pages t
set workspace_id = w.id
from public.workspaces w
where w.owner_id = t.user_id and t.workspace_id is null;
-- Fall back to the account's workspace when the page row has no creator match.
update public.social_pages t
set workspace_id = a.workspace_id
from public.social_accounts a
where a.id = t.social_account_id and t.workspace_id is null;

update public.publishing_schedules t
set workspace_id = w.id
from public.workspaces w
where w.owner_id = t.user_id and t.workspace_id is null;

update public.posts t
set workspace_id = w.id
from public.workspaces w
where w.owner_id = t.user_id and t.workspace_id is null;

update public.post_media t
set workspace_id = p.workspace_id
from public.posts p
where p.id = t.post_id and t.workspace_id is null;
update public.post_media t
set workspace_id = w.id
from public.workspaces w
where w.owner_id = t.user_id and t.workspace_id is null;

update public.publishing_logs t
set workspace_id = p.workspace_id
from public.posts p
where p.id = t.post_id and t.workspace_id is null;
update public.publishing_logs t
set workspace_id = w.id
from public.workspaces w
where w.owner_id = t.user_id and t.workspace_id is null;

-- queue_settings becomes one row per workspace instead of per user.
alter table public.queue_settings drop constraint if exists queue_settings_pkey;
update public.queue_settings q
set workspace_id = w.id
from public.workspaces w
where w.owner_id = q.user_id and q.workspace_id is null;

-- Make content tables strict; publishing logs stay nullable for engine rows
-- that no longer have a post.
alter table public.social_accounts alter column workspace_id set not null;
alter table public.social_pages alter column workspace_id set not null;
alter table public.publishing_schedules alter column workspace_id set not null;
alter table public.posts alter column workspace_id set not null;
alter table public.post_media alter column workspace_id set not null;
alter table public.queue_settings alter column workspace_id set not null;
alter table public.queue_settings add constraint queue_settings_pkey primary key (workspace_id);

-- ---------------------------------------------------------------------------
-- 5. Uniqueness and indexes move from user to workspace
-- ---------------------------------------------------------------------------
alter table public.social_accounts drop constraint if exists social_accounts_unique_member;
create unique index if not exists social_accounts_workspace_member_unique
  on public.social_accounts (workspace_id, provider, provider_account_id);

drop index if exists public.social_pages_provider_page_unique;
create unique index if not exists social_pages_workspace_provider_page_unique
  on public.social_pages (workspace_id, provider, provider_page_id);

create index if not exists social_accounts_workspace_idx
  on public.social_accounts (workspace_id);
create index if not exists social_pages_workspace_idx
  on public.social_pages (workspace_id);
create index if not exists publishing_schedules_workspace_idx
  on public.publishing_schedules (workspace_id, start_date desc);
create index if not exists posts_workspace_status_idx
  on public.posts (workspace_id, status);
create index if not exists posts_workspace_scheduled_idx
  on public.posts (workspace_id, scheduled_for);
create index if not exists posts_workspace_created_idx
  on public.posts (workspace_id, created_at desc);
create index if not exists post_media_workspace_idx
  on public.post_media (workspace_id);
create index if not exists publishing_logs_workspace_idx
  on public.publishing_logs (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Access helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_workspace(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace
      and user_id = (select auth.uid())
      and role in ('owner', 'editor')
  );
$$;

create or replace function public.is_workspace_owner(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

create or replace function public.shares_workspace_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members me
    join public.workspace_members them on them.workspace_id = me.workspace_id
    where me.user_id = (select auth.uid())
      and them.user_id = target_user
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.can_edit_workspace(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.shares_workspace_with(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.can_edit_workspace(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_owner(uuid) to authenticated, service_role;
grant execute on function public.shares_workspace_with(uuid) to authenticated, service_role;

-- Target validation is now workspace-scoped instead of user-scoped.
create or replace function public.owns_post_target(
  p_workspace_id uuid,
  p_account_id uuid,
  p_page_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (p_account_id is null or exists (
      select 1 from public.social_accounts a
      where a.id = p_account_id
        and a.workspace_id = p_workspace_id
    ))
    and (p_page_id is null or exists (
      select 1 from public.social_pages pg
      where pg.id = p_page_id
        and pg.workspace_id = p_workspace_id
        and (p_account_id is null or pg.social_account_id = p_account_id)
    ));
$$;

revoke all on function public.owns_post_target(uuid, uuid, uuid) from public, anon;
grant execute on function public.owns_post_target(uuid, uuid, uuid) to authenticated, service_role;

-- Media paths are `${uploader_user_id}/${uuid}`. A teammate may read or delete
-- an object uploaded by anyone who shares a workspace with them.
create or replace function public.can_access_media_path(folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner_user uuid;
begin
  if folder = (select auth.uid())::text then
    return true;
  end if;

  begin
    owner_user := folder::uuid;
  exception when others then
    return false;
  end;

  return public.shares_workspace_with(owner_user);
end;
$$;

revoke all on function public.can_access_media_path(text) from public, anon;
grant execute on function public.can_access_media_path(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. New user bootstrap (workspace + pending invites)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  personal_workspace uuid;
  invited_workspace uuid;
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.email
  )
  on conflict (id) do update set email = excluded.email;

  insert into public.workspaces (owner_id, name)
  values (
    new.id,
    coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'My') || '''s workspace'
  )
  returning id into personal_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (personal_workspace, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.queue_settings (workspace_id, user_id)
  values (personal_workspace, new.id)
  on conflict (workspace_id) do nothing;

  -- Accept invites that were waiting for this email address.
  insert into public.workspace_members (workspace_id, user_id, role)
  select workspace_id, new.id, role
  from public.workspace_invites
  where lower(email) = lower(coalesce(new.email, ''))
    and accepted_at is null
    and expires_at > now()
  on conflict (workspace_id, user_id) do nothing;

  select workspace_id into invited_workspace
  from public.workspace_invites
  where lower(email) = lower(coalesce(new.email, ''))
    and accepted_at is null
    and expires_at > now()
  order by created_at asc
  limit 1;

  update public.workspace_invites
  set accepted_at = now()
  where lower(email) = lower(coalesce(new.email, ''))
    and accepted_at is null;

  update public.profiles
  set active_workspace_id = coalesce(invited_workspace, personal_workspace)
  where id = new.id;

  return new;
end;
$$;

-- Self-heal for accounts created before this migration or if a signup raced the
-- trigger. Returns the caller's active workspace, creating a personal one when
-- they have none.
create or replace function public.ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  workspace uuid;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select workspace_id into workspace
  from public.workspace_members
  where user_id = caller
  order by (role = 'owner') desc, created_at asc
  limit 1;

  if workspace is not null then
    return workspace;
  end if;

  insert into public.workspaces (owner_id, name)
  values (caller, 'My workspace')
  returning id into workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace, caller, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.queue_settings (workspace_id, user_id)
  values (workspace, caller)
  on conflict (workspace_id) do nothing;

  update public.profiles
  set active_workspace_id = workspace
  where id = caller and active_workspace_id is null;

  return workspace;
end;
$$;

revoke all on function public.ensure_personal_workspace() from public, anon;
grant execute on function public.ensure_personal_workspace() to authenticated, service_role;

-- Accept invites addressed to the caller's email. The signup trigger handles
-- new accounts; this covers people who already had an account when invited.
create or replace function public.accept_workspace_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
begin
  if caller is null then
    return;
  end if;

  select email into caller_email from auth.users where id = caller;
  if caller_email is null or btrim(caller_email) = '' then
    return;
  end if;

  -- Called on every authenticated page load, so bail out before writing when
  -- there is nothing waiting for this address.
  if not exists (
    select 1 from public.workspace_invites
    where lower(email) = lower(caller_email)
      and accepted_at is null
      and expires_at > now()
  ) then
    return;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  select workspace_id, caller, role
  from public.workspace_invites
  where lower(email) = lower(caller_email)
    and accepted_at is null
    and expires_at > now()
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
  set accepted_at = now()
  where lower(email) = lower(caller_email)
    and accepted_at is null
    and expires_at > now();
end;
$$;

revoke all on function public.accept_workspace_invites() from public, anon;
grant execute on function public.accept_workspace_invites() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));

drop policy if exists "workspaces_insert_own" on public.workspaces;
create policy "workspaces_insert_own" on public.workspaces
  for insert to authenticated with check ((select auth.uid()) = owner_id);

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner" on public.workspaces
  for update to authenticated using (public.is_workspace_owner(id))
  with check (public.is_workspace_owner(id));

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner" on public.workspaces
  for delete to authenticated using (public.is_workspace_owner(id));

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_members_insert_owner" on public.workspace_members;
create policy "workspace_members_insert_owner" on public.workspace_members
  for insert to authenticated with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace_members_update_owner" on public.workspace_members;
create policy "workspace_members_update_owner" on public.workspace_members
  for update to authenticated using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace_members_delete_owner" on public.workspace_members;
create policy "workspace_members_delete_owner" on public.workspace_members
  for delete to authenticated using (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace_invites_all_owner" on public.workspace_invites;
create policy "workspace_invites_all_owner" on public.workspace_invites
  for all to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- Profiles: keep self-service, but let teammates see each other's name/avatar.
drop policy if exists "profiles_select_shared" on public.profiles;
create policy "profiles_select_shared" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or public.shares_workspace_with(id));

-- social accounts/pages
drop policy if exists "social_accounts_select_own" on public.social_accounts;
drop policy if exists "social_accounts_select_workspace" on public.social_accounts;
create policy "social_accounts_select_workspace" on public.social_accounts
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "social_accounts_delete_own" on public.social_accounts;
drop policy if exists "social_accounts_delete_workspace" on public.social_accounts;
create policy "social_accounts_delete_workspace" on public.social_accounts
  for delete to authenticated using (public.can_edit_workspace(workspace_id));

drop policy if exists "social_pages_select_own" on public.social_pages;
drop policy if exists "social_pages_select_workspace" on public.social_pages;
create policy "social_pages_select_workspace" on public.social_pages
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "social_pages_delete_own" on public.social_pages;
drop policy if exists "social_pages_delete_workspace" on public.social_pages;
create policy "social_pages_delete_workspace" on public.social_pages
  for delete to authenticated using (public.can_edit_workspace(workspace_id));

-- publishing schedules
drop policy if exists "publishing_schedules_all_own" on public.publishing_schedules;
drop policy if exists "publishing_schedules_select_workspace" on public.publishing_schedules;
create policy "publishing_schedules_select_workspace" on public.publishing_schedules
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "publishing_schedules_insert_workspace" on public.publishing_schedules;
create policy "publishing_schedules_insert_workspace" on public.publishing_schedules
  for insert to authenticated with check (
    public.can_edit_workspace(workspace_id)
    and public.owns_post_target(workspace_id, social_account_id, social_page_id)
  );

drop policy if exists "publishing_schedules_update_workspace" on public.publishing_schedules;
create policy "publishing_schedules_update_workspace" on public.publishing_schedules
  for update to authenticated
  using (public.can_edit_workspace(workspace_id))
  with check (
    public.can_edit_workspace(workspace_id)
    and public.owns_post_target(workspace_id, social_account_id, social_page_id)
  );

drop policy if exists "publishing_schedules_delete_workspace" on public.publishing_schedules;
create policy "publishing_schedules_delete_workspace" on public.publishing_schedules
  for delete to authenticated using (public.can_edit_workspace(workspace_id));

-- posts
drop policy if exists "posts_select_own" on public.posts;
drop policy if exists "posts_select_workspace" on public.posts;
create policy "posts_select_workspace" on public.posts
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "posts_insert_own" on public.posts;
drop policy if exists "posts_insert_workspace" on public.posts;
create policy "posts_insert_workspace" on public.posts
  for insert to authenticated with check (
    public.can_edit_workspace(workspace_id)
    and (select auth.uid()) = user_id
    and public.owns_post_target(workspace_id, social_account_id, social_page_id)
  );

drop policy if exists "posts_update_own" on public.posts;
drop policy if exists "posts_update_workspace" on public.posts;
create policy "posts_update_workspace" on public.posts
  for update to authenticated
  using (public.can_edit_workspace(workspace_id))
  with check (
    public.can_edit_workspace(workspace_id)
    and public.owns_post_target(workspace_id, social_account_id, social_page_id)
  );

drop policy if exists "posts_delete_own" on public.posts;
drop policy if exists "posts_delete_workspace" on public.posts;
create policy "posts_delete_workspace" on public.posts
  for delete to authenticated using (public.can_edit_workspace(workspace_id));

-- post media
drop policy if exists "post_media_all_own" on public.post_media;
drop policy if exists "post_media_select_workspace" on public.post_media;
create policy "post_media_select_workspace" on public.post_media
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "post_media_insert_workspace" on public.post_media;
create policy "post_media_insert_workspace" on public.post_media
  for insert to authenticated with check (
    public.can_edit_workspace(workspace_id)
    and (select auth.uid()) = user_id
  );

drop policy if exists "post_media_update_workspace" on public.post_media;
create policy "post_media_update_workspace" on public.post_media
  for update to authenticated
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

drop policy if exists "post_media_delete_workspace" on public.post_media;
create policy "post_media_delete_workspace" on public.post_media
  for delete to authenticated using (public.can_edit_workspace(workspace_id));

-- publishing logs are read-only for workspace members
drop policy if exists "publishing_logs_select_own" on public.publishing_logs;
drop policy if exists "publishing_logs_select_workspace" on public.publishing_logs;
create policy "publishing_logs_select_workspace" on public.publishing_logs
  for select to authenticated
  using (workspace_id is not null and public.is_workspace_member(workspace_id));

-- queue settings
drop policy if exists "queue_settings_all_own" on public.queue_settings;
drop policy if exists "queue_settings_select_workspace" on public.queue_settings;
create policy "queue_settings_select_workspace" on public.queue_settings
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "queue_settings_insert_workspace" on public.queue_settings;
create policy "queue_settings_insert_workspace" on public.queue_settings
  for insert to authenticated with check (
    public.can_edit_workspace(workspace_id)
    and (select auth.uid()) = user_id
  );

drop policy if exists "queue_settings_update_workspace" on public.queue_settings;
create policy "queue_settings_update_workspace" on public.queue_settings
  for update to authenticated
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

drop policy if exists "queue_settings_delete_workspace" on public.queue_settings;
create policy "queue_settings_delete_workspace" on public.queue_settings
  for delete to authenticated using (public.is_workspace_owner(workspace_id));

-- ---------------------------------------------------------------------------
-- 9. Table privileges
-- ---------------------------------------------------------------------------
-- Service-role and authenticated only. Supabase's default privileges hand new
-- tables to `anon` as well; a signed-out visitor has no business reading a
-- member list even though RLS would already return nothing.
revoke all on public.workspaces from anon;
revoke all on public.workspace_members from anon;
revoke all on public.workspace_invites from anon;

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.workspace_invites to authenticated;

-- social_accounts only grants column-level SELECT (tokens live in Vault), so
-- the new workspace column has to be added explicitly or every account query
-- fails with "permission denied for column workspace_id".
grant select (workspace_id) on public.social_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Storage policies â€” teammates share post images
-- ---------------------------------------------------------------------------
drop policy if exists "post_media_objects_select_own" on storage.objects;
drop policy if exists "post_media_objects_select_shared" on storage.objects;
create policy "post_media_objects_select_shared"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and public.can_access_media_path((storage.foldername(name))[1])
  );

drop policy if exists "post_media_objects_insert_own" on storage.objects;
create policy "post_media_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "post_media_objects_update_own" on storage.objects;
drop policy if exists "post_media_objects_update_shared" on storage.objects;
create policy "post_media_objects_update_shared"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'post-media'
    and public.can_access_media_path((storage.foldername(name))[1])
  );

drop policy if exists "post_media_objects_delete_own" on storage.objects;
drop policy if exists "post_media_objects_delete_shared" on storage.objects;
create policy "post_media_objects_delete_shared"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-media'
    and public.can_access_media_path((storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- 11. Queue pause + claims are workspace-scoped
-- ---------------------------------------------------------------------------
-- A collaborator's post shares the workspace queue, so pausing the queue must
-- hold their posts too. The original function joined queue_settings by user_id,
-- which no longer identifies the queue.
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
        where qs.workspace_id = p.workspace_id and qs.is_paused = true
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

revoke all on function public.claim_due_posts(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_posts(text, integer) to service_role;

