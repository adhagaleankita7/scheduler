-- ---------------------------------------------------------------------------
-- OAuth state: remember which scopes an authorization attempt requested
-- ---------------------------------------------------------------------------
-- Company-page scopes (w_organization_social / r_organization_admin) are gated
-- behind LinkedIn's Community Management API approval. While that approval is
-- pending, LinkedIn rejects the *entire* authorization with `invalid_scope`,
-- so LINKFLOW retries the connect flow with personal scopes only.
--
-- The callback must know which list the returned code was issued for: resolving
-- a token that omits `scope` against the configured org-scope list would wrongly
-- mark page publishing as available. The column is nullable so existing rows and
-- any older client keep working (the callback then falls back to env scopes).
alter table public.oauth_states
  add column if not exists scopes text;

comment on column public.oauth_states.scopes is
  'Space-separated scopes requested for this authorization attempt (personal-only after a fallback retry).';
