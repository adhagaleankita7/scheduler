#!/usr/bin/env node
/**
 * Concatenates the migrations in filename order into a single file that can be
 * pasted into the Supabase SQL Editor in one go. Generated output only - never
 * edit the bundle by hand.
 *
 *   npm run sql:bundle
 *   npm run sql:bundle -- --transaction   # wrap in begin/commit
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const outputPath = join(root, "supabase", "linkflow_full_schema.sql");
const useTransaction = process.argv.includes("--transaction");

const files = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("No migrations found in supabase/migrations.");
  process.exit(1);
}

const parts = [];

for (const file of files) {
  const sql = await readFile(join(migrationsDir, file), "utf8");
  parts.push(
    [
      "-- ---------------------------------------------------------------------------",
      `-- ${file}`,
      "-- ---------------------------------------------------------------------------",
      sql.trim(),
      "",
    ].join("\n"),
  );
}

const header = [
  "-- ===========================================================================",
  "-- LINKFLOW - full schema bundle",
  "-- ===========================================================================",
  "-- GENERATED FILE. Do not edit by hand.",
  `-- Source: supabase/migrations/ (${files.length} files, in filename order)`,
  `-- Regenerate: npm run sql:bundle${useTransaction ? " -- --transaction" : ""}`,
  "--",
  "-- Paste this whole file into the Supabase SQL Editor and run it once.",
  "-- Every statement is idempotent, so re-running is safe.",
  "-- ===========================================================================",
  "",
].join("\n");

let bundle = header + parts.join("\n");

if (useTransaction) {
  bundle = header + "begin;\n\n" + parts.join("\n") + "\ncommit;\n";
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, bundle, "utf8");

const lines = bundle.split("\n").length;
console.log(`Wrote ${outputPath}`);
console.log(`${files.length} migrations, ${lines} lines, ${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB`);
