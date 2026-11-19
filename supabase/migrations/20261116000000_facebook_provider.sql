-- ============================================================================
-- LINKFLOW · Facebook Pages provider
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
