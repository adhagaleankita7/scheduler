-- ============================================================================
-- LINKFLOW · pgTAP: atomic claiming, pause, retry, duplicate prevention
-- ============================================================================
-- Run with `npm run test:db` (Supabase CLI + Docker).
-- Everything happens in one transaction and is rolled back.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, pg_temp;

select plan(20);

-- ---------------------------------------------------------------------------
-- Fixtures: one member per scenario keeps the tests independent.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('33333333-3333-4333-8333-333333333333',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'carol@linkflow.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('44444444-4444-4444-8444-444444444444',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dave@linkflow.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('55555555-5555-4555-8555-555555555555',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'erin@linkflow.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('66666666-6666-4666-8666-666666666666',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'frank@linkflow.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('77777777-7777-4777-8777-777777777777',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'grace@linkflow.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.social_accounts (id, user_id, provider_account_id, display_name)
values
  ('99999999-9999-4999-8999-999999999999',
   '33333333-3333-4333-8333-333333333333', 'carol-member', 'Carol');

-- A due post for the happy path.
insert into public.posts (id, user_id, social_account_id, content, status, scheduled_for)
values
  ('c0000000-0000-4000-8000-000000000001',
   '33333333-3333-4333-8333-333333333333',
   '99999999-9999-4999-8999-999999999999',
   'Carol due post', 'scheduled', now() - interval '2 minutes');

-- A due post for the pause scenario.
insert into public.posts (id, user_id, content, status, scheduled_for)
values
  ('c0000000-0000-4000-8000-000000000002',
   '44444444-4444-4444-8444-444444444444',
   'Dave paused post', 'scheduled', now() - interval '2 minutes');

-- A due post for the retry scenario.
insert into public.posts (id, user_id, content, status, scheduled_for)
values
  ('c0000000-0000-4000-8000-000000000003',
   '55555555-5555-4555-8555-555555555555',
   'Erin retry post', 'scheduled', now() - interval '2 minutes');

-- A due post for the terminal-failure scenario.
insert into public.posts (id, user_id, content, status, scheduled_for)
values
  ('c0000000-0000-4000-8000-000000000004',
   '66666666-6666-4666-8666-666666666666',
   'Frank terminal post', 'scheduled', now() - interval '2 minutes');

-- An exhausted post for the max-attempts scenario.
insert into public.posts (
  id, user_id, content, status, scheduled_for, attempt_count, max_attempts
)
values
  ('c0000000-0000-4000-8000-000000000005',
   '77777777-7777-4777-8777-777777777777',
   'Grace exhausted post', 'scheduled', now() - interval '2 minutes', 5, 5);

-- An unscheduled/future post that must never be claimed.
insert into public.posts (id, user_id, content, status, scheduled_for)
values
  ('c0000000-0000-4000-8000-000000000006',
   '77777777-7777-4777-8777-777777777777',
   'Grace future post', 'scheduled', now() + interval '1 hour');

-- Simulate the service role, which is what pg_net / the Edge Function uses.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------------------------------------------------------------------
-- 1. Atomic claim
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.claim_due_posts('pgtest-worker', 20)),
  4::bigint,
  'claim_due_posts claims only the four due, retryable posts'
);

select is(
  (select status from public.posts where id = 'c0000000-0000-4000-8000-000000000001'),
  'processing',
  'a claimed post becomes processing'
);

select is(
  (select (attempt_count, locked_by) from public.posts
    where id = 'c0000000-0000-4000-8000-000000000001'),
  (1::smallint, 'pgtest-worker'),
  'a claim increments the attempt and records the worker'
);

select is(
  (select status from public.posts where id = 'c0000000-0000-4000-8000-000000000006'),
  'scheduled',
  'future posts are never claimed'
);

select is(
  (select status from public.posts where id = 'c0000000-0000-4000-8000-000000000005'),
  'scheduled',
  'posts at max_attempts are never claimed'
);

-- A second concurrent worker must find nothing left to claim.
select is(
  (select count(*) from public.claim_due_posts('pgtest-worker-2', 20)),
  0::bigint,
  'a second worker cannot re-claim in-flight posts'
);

-- ---------------------------------------------------------------------------
-- 2. Publish confirmation is exactly-once
-- ---------------------------------------------------------------------------
select is(
  public.mark_post_published(
    'c0000000-0000-4000-8000-000000000001',
    'urn:li:share:pgtest-1',
    'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3Apgtest-1',
    false,
    201
  ),
  true,
  'mark_post_published confirms a processing post'
);

select is(
  (select status from public.posts where id = 'c0000000-0000-4000-8000-000000000001'),
  'published',
  'a confirmed post becomes published'
);

select is(
  public.mark_post_published(
    'c0000000-0000-4000-8000-000000000001',
    'urn:li:share:pgtest-1-replay',
    null,
    false,
    201
  ),
  false,
  'mark_post_published refuses to publish the same post twice'
);

select is(
  (select provider_post_id from public.posts
    where id = 'c0000000-0000-4000-8000-000000000001'),
  'urn:li:share:pgtest-1',
  'a replayed confirmation leaves the original provider id untouched'
);

-- ---------------------------------------------------------------------------
-- 3. Unique provider ids per account
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.posts (
       user_id, social_account_id, content, status, provider_post_id
     ) values (
       '33333333-3333-4333-8333-333333333333',
       '99999999-9999-4999-8999-999999999999',
       'Duplicate provider id', 'published', 'urn:li:share:pgtest-1'
     ) $$,
  '23505',
  null,
  'the database rejects a duplicate provider post id on the same account'
);

-- ---------------------------------------------------------------------------
-- 4. Paused queues hold work
-- ---------------------------------------------------------------------------
update public.queue_settings
set is_paused = true
where user_id = '44444444-4444-4444-8444-444444444444';

select is(
  (select count(*) from public.claim_due_posts('pgtest-paused', 20)
    where id = 'c0000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a paused queue is not claimed'
);

select is(
  (select status from public.posts where id = 'c0000000-0000-4000-8000-000000000002'),
  'scheduled',
  'paused posts stay scheduled'
);

update public.queue_settings
set is_paused = false
where user_id = '44444444-4444-4444-8444-444444444444';

select is(
  (select count(*) from public.claim_due_posts('pgtest-resumed', 20)
    where id = 'c0000000-0000-4000-8000-000000000002'),
  1::bigint,
  'resuming a queue makes overdue posts claimable again'
);

-- ---------------------------------------------------------------------------
-- 5. Retry backoff
-- ---------------------------------------------------------------------------
select is(
  public.mark_post_failed(
    'c0000000-0000-4000-8000-000000000003',
    'rate_limited',
    'LinkedIn throttled this request.',
    429,
    true
  ),
  'scheduled',
  'a retryable failure goes back to scheduled'
);

select is(
  (select status from public.posts where id = 'c0000000-0000-4000-8000-000000000003'),
  'scheduled',
  'the retried post is scheduled with a backoff timestamp'
);

select ok(
  (select next_retry_at > now() + interval '30 seconds'
     from public.posts where id = 'c0000000-0000-4000-8000-000000000003'),
  'the first retry waits roughly one minute'
);

select is(
  (select count(*) from public.claim_due_posts('pgtest-backoff', 20)
    where id = 'c0000000-0000-4000-8000-000000000003'),
  0::bigint,
  'a post inside its backoff window is not claimed'
);

-- ---------------------------------------------------------------------------
-- 6. Terminal failure
-- ---------------------------------------------------------------------------
select is(
  public.mark_post_failed(
    'c0000000-0000-4000-8000-000000000004',
    'missing_permissions',
    'The token lacks w_member_social.',
    403,
    false
  ),
  'failed',
  'a terminal permission error fails immediately'
);

select is(
  (select (status, last_error_code, next_retry_at)
     from public.posts where id = 'c0000000-0000-4000-8000-000000000004'),
  ('failed', 'missing_permissions', null::timestamptz),
  'terminal failures do not schedule a retry'
);

select * from finish();
rollback;
