-- ============================================================================
-- LINKFLOW · Workspaces and collaborators
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
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.workspace_invites to authenticated;

-- social_accounts only grants column-level SELECT (tokens live in Vault), so
-- the new workspace column has to be added explicitly or every account query
-- fails with "permission denied for column workspace_id".
grant select (workspace_id) on public.social_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Storage policies — teammates share post images
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
