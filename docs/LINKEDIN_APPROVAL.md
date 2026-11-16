# LinkedIn app approval

LINKFLOW uses **only the official LinkedIn APIs**. There is no scraping, browser automation, or
third-party posting service. This document explains the app setup, which products and scopes you
need, and how to get company page publishing approved.

---

## 1. Create the app

1. Go to <https://www.linkedin.com/developers/apps> → **Create app**.
2. Associate it with a LinkedIn Page you administer (LinkedIn requires this).
3. Upload a logo, verify the page, and accept the API terms.

## 2. Redirect URL

Add exactly:

```text
https://your-domain.com/api/linkedin/callback
```

LinkedIn **rejects plain `http://` redirect URLs**, including `http://localhost:3000`. For local
OAuth testing, start an HTTPS tunnel to the dev server and register the tunnel URL:

```bash
# Terminal 1
npm run dev

# Terminal 2 (Cloudflare quick tunnel; any HTTPS tunnel works)
cloudflared tunnel --url http://localhost:3000
```

Then set `NEXT_PUBLIC_APP_URL=https://<tunnel-host>` (or `LINKEDIN_REDIRECT_URI=https://<tunnel-host>/api/linkedin/callback`)
and add the same URL to the LinkedIn app. The value must match
`NEXT_PUBLIC_APP_URL + /api/linkedin/callback` (or `LINKEDIN_REDIRECT_URI`) exactly.
A mismatch produces LinkedIn error `redirect_uri_mismatch`; an `http://` value fails before the
consent screen with LINKFLOW's "LinkedIn requires an HTTPS redirect URL" message.

LINKFLOW sends `state` and no PKCE parameters — LinkedIn's token endpoint answers `invalid_client`
when a `code_verifier` is present, even with valid app credentials. The callback validates `state`
against a
server-side, single-use row before exchanging the code.

## 3. Products and scopes

| Product | Scopes | Needed for |
| --- | --- | --- |
| **Sign In with LinkedIn using OpenID Connect** | `openid`, `profile`, `email` | Reading the member id, name, avatar, email |
| **Share on LinkedIn** | `w_member_social` | Publishing as a personal profile |
| **Community Management API** (approval required) | `w_organization_social`, `r_organization_admin` (or `rw_organization_admin`) | Publishing to company pages and listing pages you administer |

Default `LINKEDIN_SCOPES` (self-serve, no review needed):

```text
openid profile email w_member_social
```

LINKFLOW connects and publishes personal posts fine without org scopes; it simply shows no company
pages and explains why on `/accounts`.

**Only after the Community Management API is approved**, add the org scopes:

```text
openid profile email w_member_social w_organization_social r_organization_admin
```

Requesting an unapproved scope makes LinkedIn reject the *entire* authorization with
`invalid_scope`. LINKFLOW handles that instead of dead-ending: the connect flow records the
requested scopes with the single-use state, and when LinkedIn answers `invalid_scope` for a
request that contained org scopes it retries once with the personal set only. The connection
succeeds, `/accounts` explains that page publishing is waiting on approval, and after approval a
simple **Reconnect** picks up the org scopes — no env or code change. Keeping the personal set
first still avoids the extra round trip, so either configuration is safe.

`rw_organization_admin` is accepted as a replacement for `r_organization_admin` when LinkedIn grants
the read/write admin scope.

## 4. What each scope is used for

| Scope | Used by | Notes |
| --- | --- | --- |
| `openid` | `GET /v2/userinfo` | Returns `sub`, the LinkedIn member id. |
| `profile` | `GET /v2/userinfo` | Name and picture for the account card. |
| `email` | `GET /v2/userinfo` | Email address for the account card and audit trail. |
| `w_member_social` | `POST /rest/posts` | Author URN `urn:li:person:<sub>`. |
| `w_organization_social` | `POST /rest/posts` | Author URN `urn:li:organization:<id>`. |
| `r_organization_admin` | `GET /v2/organizationAcls` | Discover pages and the member's role. |
| `rw_organization_admin` | `GET /v2/organizationAcls` | Accepted alternative to `r_organization_admin`. |

LINKFLOW requests the self-serve personal set by default. Add the org scopes after Community
Management approval so one connection covers personal and page publishing. LinkedIn may grant
fewer scopes than requested; the accounts page compares granted scopes against the required list.

## 5. Company page publishing

To publish as a company page you need **all** of the following:

1. The LinkedIn app is approved for **Community Management API**.
2. The connecting member has an **ADMINISTRATOR** (Super Admin) or **CONTENT_ADMIN** role on the page.
3. The token includes `w_organization_social` and `r_organization_admin` (or `rw_organization_admin`).
4. The page ACL state is `APPROVED`.

How LINKFLOW checks this:

- `fetchOrganizationAccess()` calls `GET /v2/organizationAcls?q=roleAssignee` with the member token.
- It reads `role`, `state`, and the nested organization name/vanity name.
- A page is marked `can_publish` only when state is `APPROVED`, the token has
  `w_organization_social`, and the role is `ADMINISTRATOR` or `CONTENT_ADMIN`.
- Read-only roles are shown but blocked with an explanation.

If pages are missing:

- Confirm the app has Community Management access (LinkedIn may take days/weeks to approve).
- Confirm you are a Super Admin or Content Admin, not just an Analyst or Recruiter.
- Reconnect after approval so a new token with the org scopes is issued.

The `/accounts` page shows a live four-step checklist (scopes requested → app approved → page admin
role → page can publish), so the failing condition is always named instead of guessed.

## 6. App review tips

LinkedIn reviews API access manually. A strong submission:

- Describes the exact use case: “schedule and publish LinkedIn posts for a member and their company
  page”.
- Shows a working product (a demo video or staging URL).
- Explains the OAuth flow and where tokens are stored (Supabase Vault, server-side only).
- Confirms the app does not scrape, automate logins, or post without user action.
- Lists the scopes and why each is needed (see the table above).
- Includes a privacy policy and terms URL.

## 7. Token lifecycle

- Access tokens are typically valid for **60 days**.
- Refresh tokens are issued when the app is configured for them and are typically valid for
  **365 days**.
- LINKFLOW refreshes the access token automatically when it is within **5 minutes** of expiry.
- If the refresh token is missing or expired, the account is marked `needs_reconnect` and the user
  must reconnect.
- Tokens are stored in Supabase Vault and are never returned to the browser.

## 8. Rate limits and errors

LinkedIn applies per-app and per-member throttles. LINKFLOW treats `429` and throttled `403`
responses as retryable and backs off. Other `403` responses are treated as terminal permission
errors so the user is told to fix scopes or roles rather than silently retrying.

Common errors and fixes:

| Error | Meaning | Fix |
| --- | --- | --- |
| `redirect_uri_mismatch` | Redirect URL differs from the app config | Update the LinkedIn app redirect URL |
| `invalid_scope` | A requested scope is not approved | Remove it or get product approval |
| `invalid_grant` | Code expired or was already used | Start the connection again |
| `missing_permissions` (403) | Missing scope or page role | Reconnect with correct scopes / fix page role |
| `invalid_token` (401) | Token revoked or expired | Reconnect the account |
| `ACCESS_DENIED` on publish | Member cannot post to that page | Verify role and page state |

## 9. Versioning

LINKFLOW sends `LinkedIn-Version` (default `202610`, configurable through `LINKEDIN_API_VERSION`).
LinkedIn supports the current version plus the previous eleven monthly versions.
LinkedIn retires versions over time. If publishing starts returning `426 Upgrade Required` or
version errors, bump `LINKEDIN_API_VERSION` in both the web app environment and the Edge Function
secrets.

Reference: <https://learn.microsoft.com/en-us/linkedin/marketing/versioning>

## 10. Checklist

- [ ] App created and verified with a company page
- [ ] HTTPS redirect URL added for production (and an HTTPS tunnel URL for local testing)
- [ ] Sign In with LinkedIn (OpenID) added
- [ ] Share on LinkedIn added
- [ ] Community Management API requested/approved (only if you need company pages)
- [ ] `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` set in the web app and Edge Function
- [ ] `LINKEDIN_SCOPES` includes the org scopes (safe before approval — LINKFLOW falls back to a personal-only connection)
- [ ] A real personal post published successfully
- [ ] A company page appears with the correct role and `can_publish` state
