#!/usr/bin/env node
/**
 * One-command remote setup for a hosted Supabase project.
 *
 *   npm run setup:remote
 *
 * Requires in .env.local (values are never printed):
 *   SUPABASE_ACCESS_TOKEN
 *   NEXT_PUBLIC_SUPABASE_URL
 *   CRON_SECRET
 *   LINKEDIN_CLIENT_ID
 *   LINKEDIN_CLIENT_SECRET
 * Optional:
 *   LINKEDIN_API_VERSION (default 202610)
 *   LINKFLOW_ENV (default production)
 *
 * It does three things:
 *   1. Applies supabase/migrations/*.sql through the Management API.
 *   2. Sets the Edge Function secrets used by publish-scheduled-posts.
 *   3. Stores linkflow_function_url + linkflow_cron_secret in Vault.
 *
 * It intentionally does NOT deploy the function: that needs the Supabase CLI
 * and is printed as the final command. It also never enables mock mode.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiBase = "https://api.supabase.com/v1";

function loadLocalEnv() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runQuery(ref, token, query) {
  const response = await fetch(`${apiBase}/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message ?? detail;
    } catch {
      // keep the text
    }
    if (response.status === 401) {
      fail(
        "Supabase rejected SUPABASE_ACCESS_TOKEN (401). Create a new token at " +
          "https://supabase.com/dashboard/account/tokens and add it to .env.local.",
      );
    }
    fail(`Management API error ${response.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

loadLocalEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const cronSecret = process.env.CRON_SECRET?.trim();
const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
const apiVersion = process.env.LINKEDIN_API_VERSION?.trim() || "202610";
const linkflowEnv = process.env.LINKFLOW_ENV?.trim() || "production";

if (!token) {
  fail(
    "SUPABASE_ACCESS_TOKEN is not set. Create one at " +
      "https://supabase.com/dashboard/account/tokens and add it to .env.local.",
  );
}
if (!supabaseUrl) fail("NEXT_PUBLIC_SUPABASE_URL is not set.");
if (!cronSecret) fail("CRON_SECRET is not set. Generate one with `openssl rand -hex 32`.");
if (!clientId) fail("LINKEDIN_CLIENT_ID is not set.");
if (!clientSecret) fail("LINKEDIN_CLIENT_SECRET is not set.");

const ref = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)?.[1];
if (!ref) fail("Could not read a project ref from NEXT_PUBLIC_SUPABASE_URL.");

const functionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/publish-scheduled-posts`;

console.log(`Project: ${ref}`);
console.log("Step 1/3 · Applying migrations");
execFileSync(process.execPath, [join(root, "scripts", "apply-migrations.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

console.log("\nStep 2/3 · Setting Edge Function secrets");
const secrets = [
  { name: "CRON_SECRET", value: cronSecret },
  { name: "LINKEDIN_CLIENT_ID", value: clientId },
  { name: "LINKEDIN_CLIENT_SECRET", value: clientSecret },
  { name: "LINKEDIN_API_VERSION", value: apiVersion },
  { name: "LINKFLOW_ENV", value: linkflowEnv },
];

const secretResponse = await fetch(`${apiBase}/projects/${ref}/secrets`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(secrets),
});
if (!secretResponse.ok) {
  const text = await secretResponse.text();
  fail(`Could not set Edge Function secrets (HTTP ${secretResponse.status}): ${text.slice(0, 400)}`);
}
console.log(`  Set ${secrets.map((secret) => secret.name).join(", ")}`);

console.log("\nStep 3/3 · Storing cron secrets in Vault");
const vaultSql = `
do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'linkflow_function_url';
  if v_id is null then
    perform vault.create_secret(
      ${sqlLiteral(functionUrl)},
      'linkflow_function_url',
      'LINKFLOW publisher Edge Function URL'
    );
  else
    perform vault.update_secret(
      v_id,
      ${sqlLiteral(functionUrl)},
      'linkflow_function_url',
      'LINKFLOW publisher Edge Function URL'
    );
  end if;

  select id into v_id from vault.secrets where name = 'linkflow_cron_secret';
  if v_id is null then
    perform vault.create_secret(
      ${sqlLiteral(cronSecret)},
      'linkflow_cron_secret',
      'LINKFLOW cron shared secret'
    );
  else
    perform vault.update_secret(
      v_id,
      ${sqlLiteral(cronSecret)},
      'linkflow_cron_secret',
      'LINKFLOW cron shared secret'
    );
  end if;
end
$$;
`;
await runQuery(ref, token, vaultSql);
console.log("  linkflow_function_url and linkflow_cron_secret are set");

console.log("\nDone. Deploy the function next:\n");
console.log(`  npx supabase functions deploy publish-scheduled-posts --project-ref ${ref} --no-verify-jwt\n`);
console.log("Then verify everything:\n");
console.log("  npm run doctor\n");
