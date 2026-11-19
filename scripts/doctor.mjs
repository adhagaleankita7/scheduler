#!/usr/bin/env node
/**
 * LINKFLOW readiness doctor.
 *
 *   npm run doctor
 *
 * Checks, without ever printing a secret value:
 *   - required environment variables and their obvious misconfigurations
 *   - Supabase REST reachability and LINKFLOW tables
 *   - publishing-engine RPCs (existence, not execution)
 *   - whether the publish-scheduled-posts Edge Function is deployed
 *   - with SUPABASE_SERVICE_ROLE_KEY: cron jobs, Vault secrets, storage bucket,
 *     queue depth and stuck/failed posts via public.linkflow_health()
 *
 * Exit code 0 means the deployment is ready for real publishing. Exit code 1
 * means at least one required item is missing or broken.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env.local");

function loadLocalEnv() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    let value = raw.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadLocalEnv();

const results = [];
let missingTables = 0;
let missingRpc = 0;
let functionDeployed = false;

function check(label, ok, detail, { required = true } = {}) {
  results.push({ label, ok: Boolean(ok), detail, required });
  const icon = ok ? "PASS" : required ? "FAIL" : "WARN";
  console.log(`  [${icon}] ${label}${detail ? ` - ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n${title}`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const publicKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "";
const redirectUri = process.env.LINKEDIN_REDIRECT_URI?.trim() || `${appUrl}/api/linkedin/callback`;
const clientId = process.env.LINKEDIN_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim() ?? "";
const facebookAppId = process.env.FACEBOOK_APP_ID?.trim() ?? "";
const facebookAppSecret = process.env.FACEBOOK_APP_SECRET?.trim() ?? "";
const facebookConfigured = Boolean(facebookAppId && facebookAppSecret);
const facebookRedirectUri =
  process.env.FACEBOOK_REDIRECT_URI?.trim() || `${appUrl}/api/facebook/callback`;
const mockMode =
  process.env.LINKEDIN_MOCK_MODE === "true" && process.env.NODE_ENV !== "production";
// The connect route falls back to a mock account only when mock mode is on AND
// both client credentials are absent. Otherwise it starts real OAuth, so those
// checks stay required.
const canUseMockConnect = mockMode && !clientId && !clientSecret;
const realOAuthRequired = !canUseMockConnect && Boolean(clientId || clientSecret);
const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
const apiVersion = process.env.LINKEDIN_API_VERSION?.trim() || "202610";
const scopes = (process.env.LINKEDIN_SCOPES?.trim() || "openid profile email w_member_social")
  .split(/[\s,]+/)
  .filter(Boolean);
const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)?.[1] ?? "";

function inspectRedirect(uri, expectedPath = "/api/linkedin/callback") {
  try {
    const parsed = new URL(uri);
    return {
      secure: parsed.protocol === "https:",
      path: parsed.pathname,
      pathOk: parsed.pathname.replace(/\/+$/, "") === expectedPath,
      clean: !parsed.search && !parsed.hash,
      localhost: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname),
    };
  } catch {
    return { secure: false, path: "", pathOk: false, clean: false, localhost: false };
  }
}

const redirect = inspectRedirect(redirectUri);
const facebookRedirect = inspectRedirect(facebookRedirectUri, "/api/facebook/callback");

const headers = publicKey
  ? { apikey: publicKey, Authorization: `Bearer ${publicKey}` }
  : {};

const serviceHeaders = serviceKey
  ? { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  : {};

async function fetchJson(path, init = {}) {
  const response = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

function restExists(status) {
  // 200/206 = readable; 401/403 = exists but RLS/grants deny the public key.
  return status === 200 || status === 206 || status === 401 || status === 403;
}

section("Environment");
check("NEXT_PUBLIC_SUPABASE_URL", /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(url), url ? `project ${ref || "unrecognised"}` : "missing");
check("Supabase public key", Boolean(publicKey), publicKey ? "set" : "set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY");
check("SUPABASE_SERVICE_ROLE_KEY", Boolean(serviceKey), serviceKey ? "set (server-only)" : "missing - OAuth, disconnect, retry and full checks cannot run");

// Presence is not enough: a stale, truncated or rotated secret key makes every
// service-role call return 401, which shows up later as a confusing "state is
// invalid" message in the LinkedIn callback. Prove it can authenticate.
if (url && serviceKey) {
  try {
    const response = await fetch(`${url}/rest/v1/profiles?select=id&limit=0`, {
      headers: serviceHeaders,
    });
    check(
      "SUPABASE_SERVICE_ROLE_KEY accepted",
      response.ok,
      response.ok
        ? "authenticates against PostgREST"
        : `HTTP ${response.status} - copy the secret key again from Supabase → Project Settings → API`,
    );
  } catch (error) {
    check("SUPABASE_SERVICE_ROLE_KEY accepted", false, `request failed: ${error.message}`);
  }
}
check("NEXT_PUBLIC_APP_URL", Boolean(appUrl), appUrl || "missing");
check(
  "HTTPS OAuth redirect",
  redirect.secure,
  redirect.secure
    ? redirectUri
    : `${redirectUri || "(missing)"} - LinkedIn rejects http:// redirects; use an HTTPS tunnel or deployment`,
  { required: realOAuthRequired },
);
check(
  "LinkedIn redirect path",
  redirect.pathOk && redirect.clean,
  redirect.pathOk && redirect.clean
    ? "/api/linkedin/callback"
    : `${redirectUri || "(missing)"} - must be exactly .../api/linkedin/callback with no query string or fragment`,
  { required: realOAuthRequired },
);
check(
  "LinkedIn redirect host",
  !(clientId && clientSecret && redirect.localhost),
  clientId && clientSecret && redirect.localhost
    ? "localhost callback is not reachable by LinkedIn - run an HTTPS tunnel and set LINKEDIN_REDIRECT_URI"
    : "not localhost",
  { required: false },
);
// A registered-but-dead redirect host is one of the most common reasons
// "Connect LinkedIn" fails: consent completes, then the browser is sent to a
// hostname that no longer resolves (finished quick tunnel, sleeping laptop).
let redirectHost = "";
try {
  redirectHost = new URL(redirectUri).hostname;
} catch {
  redirectHost = "";
}

if (redirect.secure && realOAuthRequired && !redirect.localhost && redirectHost) {
  try {
    const probe = await fetch(redirectUri, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    check("LinkedIn redirect reachable", true, `${redirectHost} answered HTTP ${probe.status}`);
  } catch (error) {
    const reason = error.cause?.code || error.cause?.message || error.message;
    check(
      "LinkedIn redirect reachable",
      false,
      `${redirectHost} is unreachable (${reason}) - LinkedIn would return to a dead host. Start the tunnel/deployment and register the current URL in the LinkedIn app`,
    );
  }

  check(
    "Stable OAuth host",
    !/\.trycloudflare\.com$/i.test(redirectHost),
    /\.trycloudflare\.com$/i.test(redirectHost)
      ? "quick tunnel hostname changes on every restart, and each new host must be added to the LinkedIn app - use a named tunnel or a real deployment"
      : redirectHost,
    { required: false },
  );

  // Reachability is not enough: LinkedIn has to know the exact URL. An
  // unregistered redirect dead-ends the browser on "redirect_uri does not match
  // the registered value" before consent, which is the single most common
  // "Connect LinkedIn does nothing" cause. The authorization endpoint reports it
  // in the page body, so it can be checked without a browser or a real login.
  try {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: "linkflow-doctor-probe",
      scope: scopes.join(" "),
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
    const probe = await fetch(
      `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`,
      { redirect: "manual", signal: AbortSignal.timeout(20_000) },
    );
    if (probe.status >= 300 && probe.status < 400) {
      check("LinkedIn redirect registered", true, "LinkedIn accepted the callback URL");
    } else {
      const body = (await probe.text().catch(() => ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");
      if (/redirect_uri does not match the registered value/i.test(body)) {
        check(
          "LinkedIn redirect registered",
          false,
          `not registered - add ${redirectUri} under LinkedIn app → Auth → Authorized redirect URLs`,
        );
      } else if (/client_id is invalid/i.test(body)) {
        check(
          "LinkedIn redirect registered",
          false,
          "LINKEDIN_CLIENT_ID is invalid - copy it again from the LinkedIn developer app",
        );
      } else {
        check(
          "LinkedIn redirect registered",
          true,
          `could not be determined (HTTP ${probe.status}) - verify the callback URL is listed in the LinkedIn app`,
          { required: false },
        );
      }
    }
  } catch (error) {
    check(
      "LinkedIn redirect registered",
      true,
      `could not be determined (${error.message}) - verify the callback URL is listed in the LinkedIn app`,
      { required: false },
    );
  }
}

check(
  "LINKEDIN_CLIENT_ID",
  Boolean(clientId),
  clientId ? "set" : mockMode ? "missing - mock connect is available" : "missing - real OAuth cannot start",
  { required: realOAuthRequired },
);
check(
  "LINKEDIN_CLIENT_SECRET",
  Boolean(clientSecret),
  clientSecret ? "set" : mockMode ? "missing - mock connect is available" : "missing - token exchange will fail",
  { required: realOAuthRequired },
);
check("CRON_SECRET", Boolean(cronSecret), cronSecret ? "set" : "missing - automatic publishing will no-op");
check(
  "LINKEDIN_API_VERSION",
  /^\d{6}$/.test(apiVersion),
  /^\d{6}$/.test(apiVersion) ? apiVersion : `${apiVersion} - expected YYYYMM`,
);
check(
  "Personal scopes",
  ["openid", "profile", "w_member_social"].every((scope) => scopes.includes(scope)),
  scopes.join(" "),
);
const orgScopes = ["w_organization_social", "r_organization_admin", "rw_organization_admin"].filter(
  (scope) => scopes.includes(scope),
);
check(
  "Company-page scopes",
  orgScopes.length === 0 || (orgScopes.includes("w_organization_social") && (orgScopes.includes("r_organization_admin") || orgScopes.includes("rw_organization_admin"))),
  orgScopes.length === 0
    ? "not requested (personal publishing only)"
    : orgScopes.join(" "),
  { required: false },
);
check(
  "Mock publishing",
  process.env.LINKEDIN_MOCK_MODE !== "true" || process.env.NODE_ENV !== "production",
  process.env.LINKEDIN_MOCK_MODE === "true"
    ? "enabled - never enable this in production"
    : "disabled",
  { required: false },
);

check(
  "FACEBOOK_APP_ID / FACEBOOK_APP_SECRET",
  facebookConfigured || (!facebookAppId && !facebookAppSecret),
  facebookConfigured
    ? "set"
    : facebookAppId || facebookAppSecret
      ? "only one of the pair is set - Facebook connect will fail"
      : "not set - Facebook Pages cannot connect (LinkedIn is unaffected)",
  { required: facebookAppId || facebookAppSecret ? true : false },
);
check(
  "Facebook redirect path",
  facebookRedirect.secure && facebookRedirect.pathOk && facebookRedirect.clean,
  !facebookConfigured
    ? "not configured"
    : facebookRedirect.secure && facebookRedirect.pathOk && facebookRedirect.clean
      ? facebookRedirectUri
      : `${facebookRedirectUri || "(missing)"} - must be exactly https://<host>/api/facebook/callback with no query string or fragment`,
  { required: facebookConfigured },
);
check(
  "Facebook redirect host",
  !(facebookConfigured && facebookRedirect.localhost),
  facebookConfigured && facebookRedirect.localhost
    ? "localhost callback is not reachable by Facebook - run an HTTPS tunnel and set FACEBOOK_REDIRECT_URI"
    : "not localhost",
  { required: false },
);
check(
  "Mock Facebook",
  process.env.FACEBOOK_MOCK_MODE !== "true" || process.env.NODE_ENV !== "production",
  process.env.FACEBOOK_MOCK_MODE === "true"
    ? "enabled - never enable this in production"
    : "disabled",
  { required: false },
);

if (!url || !publicKey) {
  summary();
  process.exit(1);
}

section("Database (REST)");
const tables = [
  "profiles",
  "social_accounts",
  "social_pages",
  "posts",
  "post_media",
  "publishing_logs",
  "queue_settings",
  "publishing_schedules",
  "oauth_states",
];
for (const table of tables) {
  try {
    const { response } = await fetchJson(`/rest/v1/${table}?select=*&limit=0`);
    const ok = restExists(response.status);
    if (!ok) missingTables += 1;
    check(`table ${table}`, ok, `HTTP ${response.status}`);
  } catch (error) {
    missingTables += 1;
    check(`table ${table}`, false, `request failed: ${error.message}`);
  }
}

section("Publishing engine RPCs");
const engineFunctions = [
  "store_social_tokens",
  "get_social_tokens",
  "touch_social_token_refresh",
  "delete_social_tokens",
  "claim_due_posts",
  "mark_post_published",
  "mark_post_failed",
  "trigger_publish_function",
];

// Read the PostgREST catalog instead of executing functions: two of them
// (claim_due_posts, trigger_publish_function) would publish/claim real posts if
// grants were ever misconfigured. The catalog is only available to a secret key.
let catalog = null;
if (serviceKey) {
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: { ...serviceHeaders, Accept: "application/openapi+json" },
    });
    if (response.ok) catalog = await response.json();
  } catch {
    catalog = null;
  }
}

if (catalog?.paths) {
  const rpcPaths = Object.keys(catalog.paths).filter((path) => path.startsWith("/rpc/"));
  for (const name of engineFunctions) {
    const exists = rpcPaths.includes(`/rpc/${name}`);
    if (!exists) missingRpc += 1;
    check(`rpc ${name}`, exists, exists ? "present in catalog" : "missing");
  }
} else {
  check(
    "RPC catalog",
    false,
    "skipped - add SUPABASE_SERVICE_ROLE_KEY to verify engine functions without executing them",
    { required: false },
  );
  // Safe, non-publishing probes for the functions that cannot mutate posts.
  const safeProbes = [
    ["store_social_tokens", { p_account_id: null, p_access_token: null, p_refresh_token: null, p_access_expires_at: null, p_refresh_expires_at: null, p_scopes: null }],
    ["get_social_tokens", { p_account_id: null }],
    ["touch_social_token_refresh", { p_account_id: null, p_access_expires_at: null, p_refresh_expires_at: null }],
    ["delete_social_tokens", { p_account_id: null }],
    ["mark_post_published", { p_post_id: null, p_provider_post_id: null, p_provider_post_url: null, p_is_mock: false, p_http_status: null }],
    ["mark_post_failed", { p_post_id: null, p_error_code: null, p_error_message: null, p_http_status: null, p_retryable: false }],
  ];
  for (const [name, body] of safeProbes) {
    try {
      const { response, body: responseBody } = await fetchJson(`/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const exists =
        response.status === 401 ||
        response.status === 403 ||
        response.status === 200 ||
        response.status === 204 ||
        (response.status === 400 && responseBody?.code !== "PGRST202");
      if (!exists) missingRpc += 1;
      check(`rpc ${name}`, exists, `HTTP ${response.status}`);
    } catch (error) {
      missingRpc += 1;
      check(`rpc ${name}`, false, `request failed: ${error.message}`);
    }
  }
}

// linkflow_health() only reads catalog/count metadata, so it is safe to probe
// with the public key even when it is accidentally granted too broadly. This
// catches an unapplied 20261114000100_health.sql without a service-role key.
try {
  const { response } = await fetchJson("/rest/v1/rpc/linkflow_health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const installed = response.status !== 404;
  if (!installed) missingRpc += 1;
  check(
    "rpc linkflow_health",
    installed,
    installed ? `HTTP ${response.status}` : "not installed - apply supabase/migrations/20261114000100_health.sql",
  );
} catch (error) {
  missingRpc += 1;
  check("rpc linkflow_health", false, `request failed: ${error.message}`);
}

section("Edge Function");
try {
  const response = await fetch(`${url}/functions/v1/publish-scheduled-posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "doctor" }),
  });
  const text = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
  functionDeployed = response.status !== 404;
  check(
    "publish-scheduled-posts deployed",
    functionDeployed,
    response.status === 404
      ? "HTTP 404 - run: npx supabase functions deploy publish-scheduled-posts --no-verify-jwt"
      : `HTTP ${response.status}${response.status === 200 ? " - WARNING: it answered without a cron secret" : ""}`,
  );
  if (text && response.status !== 404) console.log(`         ${text}`);
} catch (error) {
  check("publish-scheduled-posts deployed", false, `request failed: ${error.message}`);
}

section("Cron, Vault and storage");
if (!serviceKey) {
  check("service-role checks", false, "skipped - add SUPABASE_SERVICE_ROLE_KEY for cron/Vault/storage verification", { required: false });
} else {
  try {
    const { response, body } = await fetchJson("/rest/v1/rpc/linkflow_health", {
      method: "POST",
      headers: { ...serviceHeaders, "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.status === 404) {
      check("linkflow_health()", false, "not installed - apply supabase/migrations/20261114000100_health.sql");
    } else if (!response.ok) {
      check("linkflow_health()", false, `HTTP ${response.status}`);
    } else {
      const health = Array.isArray(body) ? body[0] : body;
      check("linkflow_health()", true, "available");
      check("private post-media bucket", health?.storage_bucket_private === true, health?.storage_bucket_private ? "private" : "missing or public");
      check("pg_cron extension", health?.pg_cron === true, health?.pg_cron ? "installed" : "unavailable on this plan");
      check("pg_net extension", health?.pg_net === true, health?.pg_net ? "installed" : "missing - cron cannot call the function");
      check(
        "cron jobs",
        Number(health?.cron_jobs ?? 0) >= Number(health?.cron_jobs_expected ?? 2),
        `${health?.cron_jobs ?? 0}/${health?.cron_jobs_expected ?? 2} (linkflow-*)`,
      );
      check("Vault", health?.vault === true, health?.vault ? "available" : "missing");
      check(
        "cron Vault secrets",
        Number(health?.cron_secrets_present ?? 0) >= 2,
        `${health?.cron_secrets_present ?? 0}/2 (linkflow_function_url, linkflow_cron_secret)`,
      );
      check(
        "queue depth",
        true,
        `due ${health?.due_posts ?? 0}, processing ${health?.processing_posts ?? 0}, failed ${health?.failed_posts ?? 0}`,
        { required: false },
      );
      if (Number(health?.failed_posts ?? 0) > 0) {
        check("failed posts", false, "review /posts?status=failed or public.publishing_logs", { required: false });
      }
    }
  } catch (error) {
    check("linkflow_health()", false, `request failed: ${error.message}`);
  }
}

function summary() {
  const required = results.filter((item) => item.required);
  const failed = required.filter((item) => !item.ok);
  const warnings = results.filter((item) => !item.required && !item.ok);
  console.log("\nSummary");
  if (canUseMockConnect) {
    console.log(
      "  Mode: mock publishing - LinkedIn OAuth checks are warnings; connect via /accounts → Connect mock LinkedIn.",
    );
  }
  if (failed.length === 0) {
    console.log("  Ready: all required checks passed.");
  } else {
    console.log(`  Not ready: ${failed.length} required check${failed.length === 1 ? "" : "s"} failed.`);
    for (const item of failed) console.log(`    - ${item.label}: ${item.detail}`);
  }
  if (warnings.length > 0) {
    console.log(`  ${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`);
    for (const item of warnings) console.log(`    - ${item.label}: ${item.detail}`);
  }
  if (missingTables > 0 || missingRpc > 0) {
    console.log("  Apply migrations: npm run db:push:api (or paste supabase/linkflow_full_schema.sql).");
  }
  if (!functionDeployed) {
    console.log("  Deploy the function: npx supabase functions deploy publish-scheduled-posts --no-verify-jwt");
  }
  console.log("");
}

summary();
process.exit(results.some((item) => item.required && !item.ok) ? 1 : 0);
