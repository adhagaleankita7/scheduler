#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql to a hosted Supabase project through the
 * Management API. Useful when you have a personal access token but no database
 * password and no local Supabase CLI.
 *
 *   1. Create a token at https://supabase.com/dashboard/account/tokens
 *   2. Add it to .env.local as SUPABASE_ACCESS_TOKEN=sbp_...
 *   3. npm run db:push:api
 *
 * The token is only read into memory. It is never printed and never sent
 * anywhere except https://api.supabase.com.
 *
 * The SQL itself is read from supabase/migrations/ in filename order, so it can
 * never drift from the checked-in migrations.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");
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
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const detail =
      typeof body === "object" && body && "message" in body ? body.message : text.slice(0, 500);
    if (response.status === 401) {
      fail(
        "Supabase rejected the access token (401). Create a new one at " +
          "https://supabase.com/dashboard/account/tokens and put it in .env.local as SUPABASE_ACCESS_TOKEN.",
      );
    }
    if (response.status === 404) {
      fail(
        `Project ${ref} was not found for this token (404). Check NEXT_PUBLIC_SUPABASE_URL and that the ` +
          "token belongs to the account that owns the project.",
      );
    }
    fail(`Management API error ${response.status}: ${detail}`);
  }

  return body;
}

loadLocalEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

if (!token) {
  fail(
    "SUPABASE_ACCESS_TOKEN is not set. Create a personal access token at " +
      "https://supabase.com/dashboard/account/tokens, add it to .env.local " +
      "(SUPABASE_ACCESS_TOKEN=sbp_...), then run npm run db:push:api again.",
  );
}

const ref = supabaseUrl?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)?.[1];
if (!ref) {
  fail(
    "Could not read a project ref from NEXT_PUBLIC_SUPABASE_URL. Expected " +
      "https://<project-ref>.supabase.co.",
  );
}

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) fail("No .sql files found in supabase/migrations.");

const sql = files
  .map((file) => `-- ${file}\n${readFileSync(join(migrationsDir, file), "utf8").trim()}\n`)
  .join("\n");

console.log(`Project:    ${ref}`);
console.log(`Migrations: ${files.length} files (${(Buffer.byteLength(sql) / 1024).toFixed(1)} KB)`);
console.log("Applying to the hosted database...\n");

await runQuery(ref, token, sql);

console.log("✔ SQL applied. Verifying...\n");

const verification = await runQuery(
  ref,
  token,
  `select
     (select count(*)::int from pg_tables
        where schemaname = 'public'
          and tablename in ('profiles','social_accounts','social_pages','posts','post_media',
                            'publishing_logs','queue_settings','publishing_schedules',
                            'oauth_states')) as tables,
     (select count(*)::int from pg_proc
        where proname in ('claim_due_posts','mark_post_published','mark_post_failed',
                          'get_social_tokens','store_social_tokens','touch_social_token_refresh',
                          'delete_social_tokens','trigger_publish_function','linkflow_health')) as functions,
     (select count(*)::int from pg_policies where schemaname = 'public') as policies,
     (select count(*)::int from storage.buckets where id = 'post-media') as buckets;`,
);

// pg_cron lives in the `cron` schema, which may not exist on projects where the
// extension is unavailable. Query it separately so verification still works.
let cronJobs = 0;
try {
  const cronVerification = await runQuery(
    ref,
    token,
    `select count(*)::int as jobs from cron.job where jobname like 'linkflow-%';`,
  );
  cronJobs = Number((Array.isArray(cronVerification) ? cronVerification[0] : cronVerification)?.jobs ?? 0);
} catch {
  cronJobs = 0;
}

const row = Array.isArray(verification) ? verification[0] : verification;
const checks = [
  ["tables", 9, true],
  ["functions", 9, true],
  ["policies", 1, true],
  ["buckets", 1, true],
  // pg_cron is unavailable on some projects. The schema is still usable then;
  // scheduled publishing just needs the function triggered another way.
  ["cron_jobs", 2, false],
];

let ok = true;
for (const [key, expected, required] of checks) {
  const actual = key === "cron_jobs" ? cronJobs : Number(row?.[key] ?? 0);
  const pass = actual >= expected;
  if (!pass && required) ok = false;
  const label = pass ? "✔" : required ? "✖" : "!";
  const suffix = pass ? "" : required ? ` (expected at least ${expected})` : " (optional — pg_cron may be unavailable)";
  console.log(`${label} ${key.padEnd(10)} ${actual}${suffix}`);
}

if (!ok) {
  console.log(
    "\nSome objects are missing. Check the Supabase logs for the SQL run, fix the failing statement, " +
      "then run npm run db:push:api again (the migrations are idempotent).",
  );
  process.exit(1);
}

console.log("\nDone. Reload /setup — the database row should now read ready.\n");
