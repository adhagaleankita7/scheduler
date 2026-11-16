-- ============================================================================
-- LINKFLOW · 0005 — Service-role readiness report
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
