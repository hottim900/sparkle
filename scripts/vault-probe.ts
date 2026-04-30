#!/usr/bin/env tsx
/**
 * vault:probe — PR 3 active gate: verify reverse-lookup resolves every
 * items_vault.id to a non-null path.
 *
 * Read-only. Pure SQL — does not call the HTTP endpoint, so this works in CI
 * and pre-deploy contexts where the server isn't running.
 *
 * Exit codes:
 *   0  — all items_vault.id resolve via vault_files.sparkle_id
 *   1  — at least one item failed (printed)
 *   2  — invalid args
 *
 * Usage:
 *   npm run vault:probe
 *   npm run vault:probe -- --json
 *   npm run vault:probe -- --help
 */

import { existsSync } from "node:fs";
import Database from "better-sqlite3";

const HELP = `
vault:probe — items_vault.id reverse-lookup verification (read-only)

Usage:
  npm run vault:probe                  Print human-readable summary; exit 1 on miss
  npm run vault:probe -- --json        Print JSON report; exit code unchanged
  npm run vault:probe -- --help

PR 3 gate: every items_vault row must reverse-lookup successfully against
vault_files. If any miss exists, halt PR 3 — fallback is still in active use.
`;

type ProbeRow = { id: string; title: string; resolved: 0 | 1; vault_path: string | null };

function parseArgs(argv: string[]): { help: boolean; json: boolean } {
  const out = { help: false, json: false };
  for (const a of argv.slice(2)) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  const dbPath = process.env.DATABASE_URL || "./data/todo.db";
  if (!existsSync(dbPath)) {
    console.error(`✗ Database not found at ${dbPath}`);
    process.exit(1);
  }

  const sqlite = new Database(dbPath, { readonly: true });
  sqlite.pragma("journal_mode = WAL");

  const rows = sqlite
    .prepare(
      `SELECT iv.id, iv.title,
              CASE WHEN vf.path IS NOT NULL THEN 1 ELSE 0 END AS resolved,
              vf.path AS vault_path
         FROM items_vault iv
         LEFT JOIN vault_files vf ON vf.sparkle_id = iv.id
         ORDER BY iv.exported_at DESC`,
    )
    .all() as ProbeRow[];

  const total = rows.length;
  const misses = rows.filter((r) => r.resolved === 0);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          total,
          resolved: total - misses.length,
          missing: misses.length,
          misses: misses.map((m) => ({ id: m.id, title: m.title })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`📊 items_vault rows: ${total}`);
    console.log(`✅ reverse-lookup hit: ${total - misses.length}`);
    console.log(`❌ reverse-lookup miss: ${misses.length}`);
    if (misses.length > 0) {
      console.log("\nFirst 10 misses:");
      for (const m of misses.slice(0, 10)) {
        console.log(`  ${m.id}  ${m.title}`);
      }
      console.log("\nRun npm run vault:audit to investigate.");
    }
  }

  process.exit(misses.length === 0 ? 0 : 1);
}

const isDirectInvocation = process.argv[1] && process.argv[1].endsWith("vault-probe.ts");
if (isDirectInvocation) main();
