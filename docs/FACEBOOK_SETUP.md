# Connect Facebook Pages to LINKFLOW

LINKFLOW publishes to **Facebook Pages** through Meta's official Graph API.
Facebook **personal profiles** cannot be posted to by any third-party app — Meta
removed that capability — so a Facebook target is always a Page.

## 1. Create a Meta app

1. Open <https://developers.facebook.com/apps> → **Create app**.
2. Choose **Other** → **Business**, then name the app (e.g. `LINKFLOW`).
3. Add the **Facebook Login** product (Settings → Basic has your App ID and App
   Secret).

## 2. Add the redirect URI

In **Facebook Login → Settings → Valid OAuth Redirect URIs**, add exactly:

```
https://<your-domain>/api/facebook/callback
```

For local development this is usually:

```
https://<your-tunnel-host>/api/facebook/callback
```

Facebook allows `http://localhost` for testing in development mode, but a stable
HTTPS domain is required for production publishing.

## 3. Add the environment variables

```bash
FACEBOOK_APP_ID=<app-id>
FACEBOOK_APP_SECRET=<app-secret>
FACEBOOK_SCOPES=public_profile pages_show_list pages_read_engagement pages_manage_posts
FACEBOOK_GRAPH_VERSION=v23.0
# Optional override:
# FACEBOOK_REDIRECT_URI=https://<your-domain>/api/facebook/callback
```

Restart the app after changing environment variables.

## 4. Permissions and App Review

- `public_profile` is granted by default.
- `pages_show_list` + `pages_read_engagement` let LINKFLOW list your Pages.
- `pages_manage_posts` lets LINKFLOW publish to them.

In **Development mode** only app admins, developers and testers can connect.
To publish for real users, submit the app for **App Review** with
`pages_manage_posts`, complete **Business Verification**, and switch the app to
**Live**.

Request access to the Page(s) the same way you would normally: an admin of the
Page must give your Facebook user an **Admin** or **Editor** role (or grant the
app through Business Manager). LINKFLOW shows pages without content-creation
rights as read-only and blocks scheduling to them.

## 5. Test without Meta credentials (local only)

Set:

```bash
FACEBOOK_MOCK_MODE=true
```

Then open **Accounts → Connect mock Facebook**. A clearly labelled mock account
and Page are created, and publishing is simulated (`is_mock = true`). Mock mode
is hard-disabled when `NODE_ENV=production` and the Edge Function refuses to run
when `LINKFLOW_ENV=production`.

## 6. Apply the migration and deploy

The Facebook provider needs the new columns and the provider-aware Vault token
functions:

```bash
npm run db:push:api      # or paste supabase/linkflow_full_schema.sql
npm run sql:bundle       # regenerate the bundle after pulling this change
supabase functions deploy publish-scheduled-posts --no-verify-jwt
```

Add the Facebook secrets to the Edge Function environment as well:

```bash
supabase secrets set FACEBOOK_APP_ID=... FACEBOOK_APP_SECRET=... FACEBOOK_GRAPH_VERSION=v23.0
```

## How publishing works

1. OAuth returns a short-lived token, which LINKFLOW immediately exchanges for a
   long-lived (~60 day) member token.
2. The token is stored in **Supabase Vault** as
   `facebook_access_token_<account-id>` — never in a public table.
3. At publish time the worker asks `/me/accounts` for a fresh Page access token.
   Text posts go to `/{page-id}/feed`. Image posts upload the photo to
   `/{page-id}/photos` with `published=false`, then create a `/{page-id}/feed`
   post with `attached_media[0]` — this keeps it a normal Page post with an
   image instead of a photo-tab story.
4. Each attempt is written to `publishing_logs` with HTTP status and error code.
5. Retries, backoff and the every-minute scheduler are the same ones used for
   LinkedIn.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `URL Blocked: This redirect failed` | The redirect URI is not registered exactly. Copy the value shown on **Accounts** into the Meta app. |
| No Pages returned | Your user has no Admin/Editor role on any Page, or `pages_show_list` was not granted. |
| Page is read-only | Ask a Page admin for an Admin/Editor role (or Business Manager access), then reconnect. |
| `(#200) Permissions error` when publishing | `pages_manage_posts` was not approved/granted. Reconnect after App Review. |
| `API access blocked` (error 5258005) on every call, even `/me` | Meta restricted the whole app. Open the Meta App Dashboard for the app, clear the restriction (App Review, Business Verification or Data Use Checkup), switch the app to Live if required, then reconnect Facebook in LINKFLOW. |
| Token expired | Reconnect from **Accounts**. The worker also extends tokens in the last 3 days before expiry. |
| `Invalid Scopes` on the consent screen | Keep `FACEBOOK_SCOPES` to permissions the app has been approved for. |
