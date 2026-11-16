# Publishing model

This document describes exactly how LINKFLOW moves a post from `draft` to `published` (or `failed`),
how retries work, and how duplicates are prevented.

---

## 1. State machine

```
                 schedule                cron claim
   draft ──────────────────► scheduled ──────────────► processing
     ▲                          ▲   │                      │
     │                          │   │ cancel               │ success
     │ duplicate/edit           │   └──────────────┐       ▼
     │                          │                  │   published
     │                          │ retry (backoff)  │
     │                          └──────────────────┘
     │                                             │ terminal error
     │                                             ▼
     └──────────────────────────────────────── failed
                                                   │ retry (manual)
                                                   └──────────► scheduled
```

| Transition | Trigger | Guard |
| --- | --- | --- |
| `draft → scheduled` | User schedules, queues, or promotes a draft | Valid target + future time |
| `scheduled → processing` | `claim_due_posts()` | `scheduled_for <= now()`, retry time passed, attempts left, queue not paused, `FOR UPDATE SKIP LOCKED` |
| `processing → published` | `mark_post_published()` | Post must still be `processing`; provider id must be unique per account |
| `processing → scheduled` | `mark_post_failed(retryable: true)` | Attempts remain |
| `processing → failed` | `mark_post_failed(retryable: false)` or attempts exhausted | — |
| `scheduled → cancelled` | User cancels | Ownership via RLS |
| `failed → scheduled` | User retries (resets attempt counter) | Ownership verified server-side |
| `processing → scheduled/failed` | Recovery of abandoned locks | `locked_at < now() - 15 minutes` |

Server actions that reset retry counters (`retryPost`, `reschedulePost`) verify ownership with the
user-scoped client first, then use the service-role client so the `protect_post_publishing_fields`
trigger does not block the engine columns.

---

## 2. Claiming work

`public.claim_due_posts(p_worker text, p_limit integer default 20)`:

1. **Recovers abandoned claims** older than 15 minutes:
   - attempts remain → back to `scheduled`
   - attempts exhausted → `failed` with `worker_timeout`
2. **Selects due posts** where:
   - `status = 'scheduled'`
   - `scheduled_for <= now()`
   - `next_retry_at is null or next_retry_at <= now()`
   - `attempt_count < max_attempts`
   - the owner's queue is not paused
   - ordered by `scheduled_for asc`
   - limited to `least(greatest(limit, 1), 100)`
3. **Locks them** with `FOR UPDATE OF p SKIP LOCKED`, so two concurrent workers can never claim the
   same row.
4. **Marks them** `processing`, stamps `locked_at = now()`, `locked_by = worker`, increments
   `attempt_count`, and clears `next_retry_at`.

The function is `security definer`, revoked from `anon` and `authenticated`, and granted only to
`service_role`.

`max_attempts` defaults to **5** and is constrained to 1–20.

---

## 3. Publishing attempt

`publishOne()` in `supabase/functions/publish-scheduled-posts/index.ts`:

1. Loads the post, its account, page, and (if present) media.
2. Fetches tokens through `get_social_tokens(account_id)` — a service-role-only RPC that reads
   `vault.decrypted_secrets`.
3. If the access token expires within **300 seconds** and a refresh token exists, calls LinkedIn's
   token endpoint and persists the new tokens through `store_social_tokens`.
4. Downloads the private media object from Storage when `post_media` exists.
5. Calls `publishToLinkedIn()` from `_shared/linkedin.ts`:
   - uploads the image with `POST /rest/images?action=initializeUpload`, then `PUT`s the bytes
   - `POST /rest/posts` with `X-Restli-Idempotency-Key = posts.idempotency_key`
   - `LinkedIn-Version: LINKEDIN_API_VERSION`
   - author URN is `urn:li:person:<member>` or `urn:li:organization:<page>`
6. Writes a `publishing_logs` row for the attempt.
7. Calls `mark_post_published` or `mark_post_failed`.

The Edge Function processes up to **20 posts per invocation**, sequentially. The cron schedule is
once per minute.

---

## 4. Error classification

`classifyLinkedInStatus()` maps HTTP responses to a stable code, a user-facing message, and a
retry flag.

| HTTP | Code | Retryable | Typical cause |
| --- | --- | --- | --- |
| 401 | `invalid_token` | no | Token revoked or malformed → reconnect |
| 403 (not throttled) | `missing_permissions` | no | Missing scope or company page role |
| 403 with throttle text / 429 | `rate_limited` | yes | LinkedIn throttling |
| 409 | `duplicate_post` | no | LinkedIn already has this post |
| 408 / 425 | `network_error` | yes | Timeout / too early |
| 400 / 422 | `invalid_content` | no | Rejected commentary or media |
| 5xx | `linkedin_server_error` | yes | LinkedIn outage |
| fetch failure / abort | `network_error` | yes | DNS, TLS, timeout |
| image upload failure | `image_upload_failed` | yes | Temporary upload problem |

Anything else becomes `unknown_error` and is retryable only when the HTTP status is ≥ 500.

**Terminal permission errors** (`invalid_token`, `expired_token`, `missing_permissions`) fail
immediately and are surfaced on the dashboard and accounts page. They are never retried blindly.

---

## 5. Backoff

```
delay_seconds = min(2^(attempt_number - 1) × 60, 3600)
```

| Attempt that failed | Delay before retry |
| --- | --- |
| 1 | 1 min |
| 2 | 2 min |
| 3 | 4 min |
| 4 | 8 min |
| 5 | 16 min |
| 6+ | capped at 60 min |

Because the default `max_attempts` is 5, a post stops after five attempts. The delay is computed in
`mark_post_failed` (SQL) and mirrored in `computeRetryDelaySeconds` (TypeScript) for tests and UI
copy.

Retries reuse the same `idempotency_key` and the post's `id`, so a retry after a timeout cannot
create a second LinkedIn post once LinkedIn has accepted the first request.

---

## 6. Idempotency and duplicate prevention

Three independent layers:

1. **`X-Restli-Idempotency-Key`** — LinkedIn deduplicates retries of the same request.
2. **`mark_post_published` guard** — only a post still in `processing` can become `published`, and
   the function returns `false` if it was already transitioned.
3. **Unique index** — `posts_provider_post_unique` on `(social_account_id, provider_post_id)` where
   `provider_post_id is not null`. Even a rogue second write cannot store the same provider post
   twice.

`posts_idempotency_key` is a UUID generated once at insert and protected from client updates by the
publishing-fields trigger.

---

## 7. Paused queues

`queue_settings.is_paused` is checked inside `claim_due_posts`. A paused queue means:

- Due posts remain `scheduled`; nothing is claimed.
- No retry timers are lost.
- On resume, the next cron invocation claims all overdue posts in `scheduled_for` order.

OAuth connect and queue management remain available while paused.

---

## 8. Logs

Every attempt produces one row in `public.publishing_logs`:

| Column | Meaning |
| --- | --- |
| `attempt` | Value of `attempt_count` for this try |
| `status` | `started`, `success`, `failure`, `retry_scheduled`, `skipped` |
| `provider` | `linkedin` or `mock` |
| `http_status` | LinkedIn HTTP status when available |
| `provider_post_id` | The published URN on success |
| `error_code` | Stable machine-readable code |
| `message` | Human-readable summary |
| `is_mock` | True only for simulated publishes |
| `metadata` | Extra context (provider URL, image URN, timing) |

Logs are insert-only for the Edge Function and readable by the owning user via RLS.

---

## 9. Mock mode

When `LINKEDIN_MOCK_MODE=true` **and** `LINKFLOW_ENV` is not `production`:

- `publishToLinkedIn` short-circuits to `buildMockResult`.
- The provider id is prefixed `urn:li:share:mock_`.
- `is_mock = true` is stored on the post and the log.
- The UI shows a persistent mock banner and labels the post.

The function returns HTTP 500 and refuses to run if mock mode is combined with
`LINKFLOW_ENV=production`. This is intentional: mock results must never be mistaken for real
publishing.

---

## 10. Timezones

- Every timestamp is stored as `timestamptz` in UTC.
- The UI, planner, calendar, and queue compute wall-clock times in the user's timezone
  (`Asia/Kolkata` by default) and convert with `zonedDateTimeToUtc`.
- DST transitions are handled by `date-fns-tz`. Ambiguous times resolve to the earlier offset, and
  non-existent times resolve to a real instant using the pre-transition offset (for example,
  `2026-03-08 02:30` in New York becomes `01:30` local). No post is ever dropped, but scheduling
  inside a missing hour is visible in the calendar. See `docs/TESTING.md` for the pinned cases.
