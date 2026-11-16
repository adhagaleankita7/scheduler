/**
 * LINKFLOW workflow verification.
 *
 * Proves the deterministic parts of the product end-to-end without touching
 * LinkedIn or a database:
 *
 *   1. Seven consecutive days are scheduled at the same wall-clock time and
 *      stored as correct UTC instants (including across a DST change).
 *   2. Calendar windows are Monday-based and use exclusive range ends.
 *   3. Every LinkedIn error class maps to the documented retry decision.
 *   4. Backoff follows min(2^(n-1) x 60s, 1h).
 *   5. Mock publishing is explicitly labelled and never calls the network.
 *
 * It also reports which credentials are present, but it never claims that real
 * publishing has been verified. Only a real LinkedIn app plus a connected
 * account can prove that.
 *
 * Usage: npm run verify:workflow
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildWeekSchedule,
  nextQueueSlots,
} from "../src/lib/scheduling/slots";
import { formatInZone, zonedDateTimeToUtc } from "../src/lib/scheduling/timezone";
import { getCalendarWindow } from "../src/lib/scheduling/calendar";
import {
  buildAuthorUrn,
  buildPostPayload,
  classifyLinkedInStatus,
  computeRetryDelaySeconds,
  publishToLinkedIn,
} from "../supabase/functions/_shared/linkedin";

const KOLKATA = "Asia/Kolkata";
const NEW_YORK = "America/New_York";

/**
 * `tsx` does not load Next.js env files, so honour `.env.local` explicitly.
 * Existing process env always wins, which keeps CI overrides working.
 */
function loadLocalEnv() {
  const path = join(process.cwd(), ".env.local");
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

loadLocalEnv();

type Result = { area: string; name: string; ok: boolean; detail: string };
const results: Result[] = [];

function equal<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, received ${a}`);
}

function check(area: string, name: string, run: () => string) {
  try {
    const detail = run();
    results.push({ area, name, ok: true, detail });
  } catch (error) {
    results.push({
      area,
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function asyncCheck(area: string, name: string, run: () => Promise<string>) {
  try {
    const detail = await run();
    results.push({ area, name, ok: true, detail });
  } catch (error) {
    results.push({
      area,
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// 1. Seven-day scheduling
// ---------------------------------------------------------------------------
async function main() {
check("scheduling", "Seven consecutive days at 10:00 Asia/Kolkata", () => {
  const week = buildWeekSchedule({
    startDate: "2026-01-12", // Monday
    timeZone: KOLKATA,
    times: Array.from({ length: 7 }, () => "10:00"),
    contents: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  });

  equal(week.length, 7, "entry count");
  equal(
    week.map((entry) => entry.dateKey),
    [
      "2026-01-12",
      "2026-01-13",
      "2026-01-14",
      "2026-01-15",
      "2026-01-16",
      "2026-01-17",
      "2026-01-18",
    ],
    "date keys",
  );

  for (const entry of week) {
    if (formatInZone(entry.iso, KOLKATA, "HH:mm") !== "10:00") {
      throw new Error(`${entry.dateKey} did not resolve to 10:00 local time`);
    }
    if (formatInZone(entry.iso, KOLKATA, "yyyy-MM-dd") !== entry.dateKey) {
      throw new Error(`${entry.dateKey} shifted to another calendar day`);
    }
  }

  equal(week[0].iso, "2026-01-12T04:30:00.000Z", "Kolkata UTC offset");
  return "7 posts, all 10:00 local, 04:30Z stored";
});

check("scheduling", "Wall-clock time survives the US spring-forward", () => {
  const week = buildWeekSchedule({
    startDate: "2026-03-08", // DST starts in New York
    timeZone: NEW_YORK,
    times: Array.from({ length: 3 }, () => "10:00"),
    contents: ["Sun", "Mon", "Tue"],
  });

  for (const entry of week) {
    equal(formatInZone(entry.iso, NEW_YORK, "HH:mm"), "10:00", `${entry.dateKey} local time`);
  }
  equal(week[0].iso, "2026-03-08T14:00:00.000Z", "post-transition UTC");
  return "10:00 local stays 10:00 local (EDT after the change)";
});

check("scheduling", "Queue slots skip past times and honour weekdays", () => {
  const slots = nextQueueSlots({
    now: new Date("2026-01-15T05:00:00Z"), // 10:30 in Kolkata
    timeZone: KOLKATA,
    postingDays: [1, 3, 5],
    postingTimes: ["10:00"],
    count: 3,
  });

  equal(
    slots.map((slot) => slot.dateKey),
    ["2026-01-16", "2026-01-19", "2026-01-21"],
    "Fri/Mon/Wed sequence",
  );
  return "next three Monday/Wednesday/Friday slots computed";
});

// ---------------------------------------------------------------------------
// 2. Calendar windows
// ---------------------------------------------------------------------------
check("calendar", "March 2026 month grid is Monday-based and padded", () => {
  const window = getCalendarWindow("month", "2026-03-15", KOLKATA);
  equal(window.days.length, 42, "grid length");
  if (window.days[0].dateKey !== "2026-02-23") {
    throw new Error(`grid starts on ${window.days[0].dateKey}, expected 2026-02-23`);
  }
  if (window.endDateKey !== "2026-04-05") {
    throw new Error(`grid ends on ${window.endDateKey}, expected 2026-04-05`);
  }
  equal(window.days.filter((day) => day.inPeriod).length, 31, "March day count");
  return "42 days, 31 in-period, 2026-02-23 → 2026-04-05";
});

check("calendar", "Week and day ranges have exclusive end instants", () => {
  const week = getCalendarWindow("week", "2026-01-15", KOLKATA);
  equal(week.days.length, 7, "week length");
  if (week.startIso !== "2026-01-11T18:30:00.000Z") {
    throw new Error(`week start ${week.startIso}`);
  }
  if (week.endIso !== "2026-01-18T18:30:00.000Z") {
    throw new Error(`week end ${week.endIso}`);
  }

  const day = getCalendarWindow("day", "2026-01-15", KOLKATA);
  const start = new Date(day.startIso).getTime();
  const end = new Date(day.endIso).getTime();
  equal(end - start, 24 * 60 * 60 * 1000, "day duration");
  return "week is 7 days; day window is exactly 24h";
});

// ---------------------------------------------------------------------------
// 3. Error classification and retry policy
// ---------------------------------------------------------------------------
check("publishing", "Error classification matches the retry table", () => {
  const cases: Array<[number, string, string, boolean]> = [
    [401, "", "invalid_token", false],
    [403, "forbidden", "missing_permissions", false],
    [429, "slow down", "rate_limited", true],
    [400, "bad commentary", "invalid_content", false],
    [409, "duplicate", "duplicate_post", false],
    [503, "unavailable", "linkedin_server_error", true],
  ];

  for (const [status, body, code, retryable] of cases) {
    const classified = classifyLinkedInStatus(status, body);
    equal(classified.code, code, `HTTP ${status} code`);
    equal(classified.retryable, retryable, `HTTP ${status} retryable`);
  }
  return "401/403/400/409 terminal; 429/5xx retryable";
});

check("publishing", "Backoff is exponential and capped at one hour", () => {
  const expected = [60, 120, 240, 480, 960, 1920, 3600, 3600];
  equal(expected.map((_, index) => computeRetryDelaySeconds(index + 1)), expected, "backoff");
  equal(computeRetryDelaySeconds(0), 60, "attempt 0 floor");
  return "1m → 2m → 4m → 8m → 16m → 32m → 60m cap";
});

check("publishing", "Author and payload switch between member and page", () => {
  equal(buildAuthorUrn({ memberId: "abc" }), "urn:li:person:abc", "member URN");
  equal(
    buildAuthorUrn({ memberId: "abc", organizationId: "123" }),
    "urn:li:organization:123",
    "organization URN",
  );
  const payload = buildPostPayload({ commentary: "Hello", memberId: "abc" });
  equal(payload.visibility, "PUBLIC", "visibility");
  equal(payload.lifecycleState, "PUBLISHED", "lifecycle state");
  return "member and company-page payloads build correctly";
});

// ---------------------------------------------------------------------------
// 4. Mock publishing stays honest
// ---------------------------------------------------------------------------
await asyncCheck("mock", "Mock publish is labelled and never calls the network", async () => {
  let networkCalls = 0;
  const fetchImpl = (async () => {
    networkCalls += 1;
    throw new Error("network must not be used in mock mode");
  }) as unknown as typeof fetch;

  const result = await publishToLinkedIn(
    {
      postId: "11111111-1111-4111-8111-111111111111",
      memberId: "member-123",
      commentary: "Mock verification post",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      accessToken: "not-a-real-token",
      apiVersion: "202601",
      fetchImpl,
    },
    { mock: true },
  );

  equal(result.isMock, true, "isMock flag");
  equal(result.providerPostUrl, null, "provider URL");
  if (!result.providerPostId.startsWith("urn:li:share:mock_")) {
    throw new Error(`mock id not prefixed: ${result.providerPostId}`);
  }
  equal(networkCalls, 0, "network calls");
  return `simulated id ${result.providerPostId}`;
});

// ---------------------------------------------------------------------------
// Expected-invalid input is rejected before any request
// ---------------------------------------------------------------------------
await asyncCheck("publishing", "Empty and oversized posts are rejected locally", async () => {
  let networkCalls = 0;
  const fetchImpl = (async () => {
    networkCalls += 1;
    throw new Error("should not be called");
  }) as unknown as typeof fetch;

  const base = {
    postId: "11111111-1111-4111-8111-111111111111",
    memberId: "member-123",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    accessToken: "not-a-real-token",
    apiVersion: "202601",
    fetchImpl,
  };

  for (const commentary of ["   ", "a".repeat(3001)]) {
    try {
      await publishToLinkedIn({ ...base, commentary });
      throw new Error("invalid content was accepted");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error;
      equal((error as { code: string }).code, "invalid_content", "error code");
    }
  }
  equal(networkCalls, 0, "network calls");
  return "empty and >3000-character posts fail with invalid_content";
});

// ---------------------------------------------------------------------------
// 5. Environment readiness (informational, never a fake success)
// ---------------------------------------------------------------------------
type Readiness = { label: string; ready: boolean; detail: string };
const readiness: Readiness[] = [
  {
    label: "Supabase URL + public key",
    ready: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    ),
    detail: "Required for auth and the dashboard",
  },
  {
    label: "Supabase service role key",
    ready: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    detail: "Required for token RPCs and admin actions",
  },
  {
    label: "LinkedIn client id + secret",
    ready: Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
    detail: "Required for real OAuth and publishing",
  },
  {
    label: "CRON_SECRET",
    ready: Boolean(process.env.CRON_SECRET),
    detail: "Shared secret between pg_net and the Edge Function",
  },
  {
    label: "Migrations present",
    ready: ["20260101000100_core_schema.sql", "20260101000200_publishing_engine.sql", "20260101000300_cron.sql"].every(
      (file) => existsSync(join(process.cwd(), "supabase", "migrations", file)),
    ),
    detail: "supabase/migrations",
  },
  {
    label: "Edge Function present",
    ready: existsSync(
      join(process.cwd(), "supabase", "functions", "publish-scheduled-posts", "index.ts"),
    ),
    detail: "publish-scheduled-posts",
  },
];

// A sanity check on the timezone conversion used everywhere.
check("timezone", "UTC storage round-trips to local wall clock", () => {
  const iso = zonedDateTimeToUtc("2026-01-15", "10:00", KOLKATA).toISOString();
  equal(iso, "2026-01-15T04:30:00.000Z", "converted instant");
  equal(formatInZone(iso, KOLKATA, "HH:mm"), "10:00", "round-trip");
  return "2026-01-15 10:00 IST = 04:30Z";
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pad = (value: string, width: number) => value.padEnd(width, " ").slice(0, width);

console.log("");
console.log("LINKFLOW workflow verification");
console.log("==============================");
console.log("");

for (const result of results) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"}  ${pad(result.area, 11)} ${result.name}`,
  );
  console.log(`      ${result.detail}`);
}

console.log("");
console.log("Environment readiness");
console.log("---------------------");
for (const item of readiness) {
  console.log(`${item.ready ? "ready  " : "missing"}  ${item.label} — ${item.detail}`);
}

const demo = process.env.LINKFLOW_DEMO_MODE === "1";
const mock = process.env.LINKEDIN_MOCK_MODE === "true";
if (demo || mock) {
  console.log("");
  console.log(
    `Mode: ${[demo && "demo UI", mock && "mock publishing"].filter(Boolean).join(" + ")} — results above are simulated, not real LinkedIn output.`,
  );
}

const failed = results.filter((result) => !result.ok);
console.log("");
if (failed.length > 0) {
  console.error(`${failed.length} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`${results.length} checks passed.`);
  console.log(
    "Real LinkedIn delivery is verified only by running the workflow against an approved app:",
  );
  console.log("  1. connect an account, 2. schedule a post 2 minutes out, 3. watch the Edge Function logs.");
}
}

main().catch((error) => {
  console.error("Workflow verification crashed:", error);
  process.exitCode = 1;
});
