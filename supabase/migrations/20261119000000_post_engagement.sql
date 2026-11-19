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
