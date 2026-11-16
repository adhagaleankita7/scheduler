-- ============================================================================
-- LINKFLOW · 0003 — pg_cron + pg_net every-minute publisher
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
