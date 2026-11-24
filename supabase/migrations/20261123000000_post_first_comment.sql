-- ---------------------------------------------------------------------------
-- post first comment
-- ---------------------------------------------------------------------------
-- Optional comment the worker posts immediately after a successful publish.
-- This is a common scheduler feature: keep the post copy clean and put links
-- or a long list of hashtags in the first comment instead.
--
-- 1250 characters is LinkedIn's per-comment limit, so enforce it everywhere.
alter table public.posts
  add column if not exists first_comment text;

alter table public.posts
  drop constraint if exists posts_first_comment_length;

alter table public.posts
  add constraint posts_first_comment_length
  check (
    first_comment is null
    or char_length(btrim(first_comment)) between 1 and 1250
  );
