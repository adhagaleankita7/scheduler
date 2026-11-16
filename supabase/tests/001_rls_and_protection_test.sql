-- ============================================================================
-- LINKFLOW · pgTAP: RLS isolation + engine-field protection
-- ============================================================================
-- Run with `npm run test:db` (Supabase CLI + Docker).
-- Everything happens in one transaction and is rolled back.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, pg_temp;

select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures: two members. The auth trigger creates their profile + queue row.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('11111111-1111-4111-8111-111111111111',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alice@linkflow.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Alice"}', now(), now()),
  ('22222222-2222-4222-8222-222222222222',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bob@linkflow.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Bob"}', now(), now());

select is(
  (select count(*) from public.queue_settings
    where user_id in ('11111111-1111-4111-8111-111111111111',
                      '22222222-2222-4222-8222-222222222222')),
  2::bigint,
  'new auth users get a queue_settings row'
);

insert into public.posts (id, user_id, content, status)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111', 'Alice draft', 'draft'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '22222222-2222-4222-8222-222222222222', 'Bob draft', 'draft');

-- ---------------------------------------------------------------------------
-- 1. Read isolation
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select results_eq(
  $$ select id from public.posts order by id $$,
  $$ values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) $$,
  'RLS: a member only sees their own posts'
);

select results_eq(
  $$ select id from public.posts where user_id = '22222222-2222-4222-8222-222222222222' $$,
  $$ select null::uuid where false $$,
  'RLS: another member''s posts are invisible'
);

-- ---------------------------------------------------------------------------
-- 2. Write isolation
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.posts (user_id, content)
     values ('22222222-2222-4222-8222-222222222222', 'spoofed') $$,
  '42501',
  null,
  'RLS: a member cannot insert a post for someone else'
);

select lives_ok(
  $$ insert into public.posts (id, user_id, content)
     values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
             '11111111-1111-4111-8111-111111111111', 'Alice second post') $$,
  'RLS: a member can insert their own post'
);

select is(
  (select count(*) from public.posts where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  1::bigint,
  'RLS: the inserted post is visible to its owner'
);

select results_eq(
  $$ update public.posts set content = 'hijacked'
      where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      returning id $$,
  $$ select null::uuid where false $$,
  'RLS: a member cannot update another member''s post'
);

-- ---------------------------------------------------------------------------
-- 3. Engine-field protection (client role)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.posts (user_id, content, status)
     values ('11111111-1111-4111-8111-111111111111', 'sneaky', 'processing') $$,
  '42501',
  null,
  'trigger: clients cannot create a post already processing'
);

select throws_ok(
  $$ update public.posts set status = 'published'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501',
  null,
  'trigger: clients cannot mark a post published'
);

-- Client-supplied engine columns are ignored, not trusted.
select lives_ok(
  $$ update public.posts
        set attempt_count = 99,
            provider_post_id = 'urn:li:share:forged',
            is_mock = true,
            locked_by = 'not-the-engine'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'trigger: engine column writes are accepted but neutralised'
);

select is(
  (select (attempt_count, provider_post_id, is_mock, locked_by)
     from public.posts
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  (0::smallint, null::text, false, null::text),
  'trigger: attempt/provider/lock fields cannot be forged by clients'
);

reset role;

select * from finish();
rollback;
