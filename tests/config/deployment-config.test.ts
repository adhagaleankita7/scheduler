import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static sanity checks for the pieces that cannot be executed in unit tests:
 * pg_cron SQL, the Vault contract between SQL and the Edge Function, and the
 * env template. They catch accidental drift (renamed secret, changed schedule,
 * or a committed secret) during review.
 */

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

const cronSql = read("supabase/migrations/20260101000300_cron.sql");
const engineSql = read("supabase/migrations/20260101000200_publishing_engine.sql");
const healthSql = read("supabase/migrations/20261114000100_health.sql");
const edgeFunction = read("supabase/functions/publish-scheduled-posts/index.ts");
const envExample = read(".env.example");
const gitignore = read(".gitignore");

describe("pg_cron publishing schedule", () => {
  it("runs every minute and calls the Vault-backed bridge", () => {
    expect(cronSql).toMatch(/jobname\s*=\s*'linkflow-publish-every-minute'/);
    expect(cronSql).toMatch(
      /cron\.schedule\(\s*'linkflow-publish-every-minute',\s*'\* \* \* \* \*',\s*'select public\.trigger_publish_function\(\);'/,
    );
  });

  it("cleans abandoned OAuth state rows", () => {
    expect(cronSql).toContain("'linkflow-cleanup-oauth-state'");
    expect(cronSql).toMatch(/delete from public\.oauth_states/);
  });

  it("survives local stacks without pg_cron instead of failing the migration", () => {
    expect(cronSql).toContain("exception when others then");
    expect(cronSql).toContain("pg_cron extension unavailable");
  });
});

describe("Vault contract", () => {
  const secretNames = ["linkflow_function_url", "linkflow_cron_secret"];

  it("uses the same two secret names in SQL, health checks and the README", () => {
    for (const name of secretNames) {
      expect(engineSql).toContain(name);
      expect(healthSql).toContain(name);
      expect(read("README.md")).toContain(name);
    }
  });

  it("sends the cron secret in the x-cron-secret header", () => {
    expect(engineSql).toContain("'x-cron-secret'");
    expect(edgeFunction).toContain('req.headers.get("x-cron-secret")');
    expect(edgeFunction).toContain('cronSecret = env("CRON_SECRET")');
  });

  it("counts exactly two LINKFLOW cron jobs", () => {
    expect(healthSql).toContain("jobname like 'linkflow-%'");
    expect(healthSql).toContain("'cron_jobs_expected', 2");
  });
});

describe("publishing Edge Function safety", () => {
  it("authenticates with a shared secret or service-role bearer", () => {
    expect(edgeFunction).toContain("timingSafeEqual(providedSecret, cronSecret)");
    expect(edgeFunction).toContain("timingSafeEqual(bearer, serviceKey)");
    expect(edgeFunction).toContain('return json({ error: "Unauthorized" }, 401)');
  });

  it("refuses mock publishing in production", () => {
    expect(edgeFunction).toContain('mock && env("LINKFLOW_ENV") === "production"');
    expect(edgeFunction).toContain("Refusing to run");
  });

  it("requires a service role key before creating the admin client", () => {
    expect(edgeFunction).toContain(
      'if (!env("SUPABASE_URL") || !serviceKey)',
    );
  });
});

describe("environment template and secret hygiene", () => {
  it("documents the exact LinkedIn callback path and HTTPS override", () => {
    expect(envExample).toContain("/api/linkedin/callback");
    expect(envExample).toMatch(/# LINKEDIN_REDIRECT_URI=https:\/\/<tunnel-host>\/api\/linkedin\/callback/);
  });

  it("keeps the LinkedIn app credentials out of NEXT_PUBLIC_ variables", () => {
    expect(envExample).not.toMatch(/NEXT_PUBLIC_LINKEDIN_CLIENT_SECRET/);
    expect(envExample).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("contains only placeholders, never a real-looking secret", () => {
    expect(envExample).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT
    expect(envExample).not.toMatch(/sb_secret_[A-Za-z0-9]+/);
    expect(envExample).not.toMatch(/sbp_[A-Za-z0-9]{20,}/);
  });

  it("ignores env files except the committed template", () => {
    expect(gitignore).toMatch(/^\.env\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });
});
