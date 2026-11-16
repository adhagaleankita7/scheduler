-- ============================================================================
-- LINKFLOW · 0001 — Core schema, RLS, storage
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
-- social_accounts — tokens live in Vault, never in this table
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
-- social_pages — authorized LinkedIn company pages
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
-- publishing_schedules — a named 7-day / weekly plan
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
-- Table privileges — authenticated users may not write engine tables directly
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
