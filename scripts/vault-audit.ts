#!/usr/bin/env tsx
/**
 * vault:audit — Read-only inventory of vault sync issues.
 *
 * Two categories of problems are surfaced:
 *
 *   1. vault_files.sparkle_id IS NULL but the on-disk .md frontmatter
 *      contains a valid sparkle_id (= candidates that migration v24 will
 *      backfill).
 *
 *   2. items_vault.id has no row in vault_files (not findable via
 *      reverse-lookup). Migration v24 halts on these — operator must
 *      resolve them before v24 can promote schema_version 23 → 24.
 *
 * Interactive flow per orphan: archive / re-audit / skip.
 *
 * Usage:
 *   npm run vault:audit
 *   npm run vault:audit -- --help
 *   npm run vault:audit -- --batch=archive-all
 *   npm run vault:audit -- --batch=skip-all
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import readline from "node:readline";
import Database from "better-sqlite3";
import { extractSparkleId } from "../server/lib/vault-backfill.js";

const HELP = `
vault:audit — Vault sync inventory CLI (read-only DB scan + interactive resolution)

Usage:
  npm run vault:audit
  npm run vault:audit -- --batch=archive-all
  npm run vault:audit -- --batch=skip-all
  npm run vault:audit -- --help

Concept glossary:
  vault_files       — index of every .md file in your Obsidian vault, keyed by path
  items_vault       — Sparkle's metadata snapshot of exported notes (post v1.4.0 split)
  sparkle_id        — UUID stored in YAML frontmatter; identity that survives renames
  reverse-lookup    — find current vault path via vault_files.sparkle_id (path is derived, not stored)
  orphan            — items_vault row with no vault_files reverse-lookup match

Two halt categories surface as separate sections:
  Category A — vault_files.sparkle_id NULL but frontmatter has sparkle_id (v24 backfills these)
  Category B — items_vault row has no vault_files match (v24 halts; operator resolves)

Flags:
  --batch=archive-all   Auto-archive (status='archived') every Category B orphan
  --batch=skip-all      Auto-skip every Category B orphan into pendings.json
  --help                Show this message

Output: scripts/vault-audit-report.json (consumed by migration v24 + operator review)
`;

type Args = {
  help: boolean;
  batch: "archive-all" | "skip-all" | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, batch: null };
  for (const arg of argv.slice(2)) {
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--batch=archive-all") args.batch = "archive-all";
    else if (arg === "--batch=skip-all") args.batch = "skip-all";
    else if (arg.startsWith("--batch=")) {
      console.error(`Unknown batch mode: ${arg}. Use --batch=archive-all or --batch=skip-all`);
      process.exit(2);
    }
  }
  return args;
}

type Category1 = { path: string; sparkle_id: string };
type Category2 = { id: string; title: string; export_path: string | null };

type AuditReport = {
  generated_at: string;
  category_1_backfillable: Category1[];
  category_2_orphans_unresolved: Category2[];
  category_2_resolved: Array<{ id: string; resolution: "archive" | "skip" }>;
  ready_for_v24: boolean;
};

async function main(): Promise<void> {
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

  // Read-only open per R2-NEW-9 / R2-25
  const sqlite = new Database(dbPath, { readonly: true });
  sqlite.pragma("journal_mode = WAL");

  const vaultPathRow = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("obsidian_vault_path") as { value: string } | undefined;

  const enabledRow = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("obsidian_enabled") as { value: string } | undefined;

  if (!enabledRow || enabledRow.value !== "true" || !vaultPathRow?.value) {
    console.log("ℹ️  Obsidian is not configured — nothing to audit.");
    process.exit(0);
  }

  const vaultPath = vaultPathRow.value;
  console.log(`🔎 Scanning vault at ${vaultPath}\n`);

  const filesNullSparkleId = sqlite
    .prepare("SELECT path FROM vault_files WHERE sparkle_id IS NULL")
    .all() as { path: string }[];

  const category1: Category1[] = [];
  for (const row of filesNullSparkleId) {
    try {
      const content = await readFile(join(vaultPath, row.path), "utf-8");
      const id = extractSparkleId(content);
      if (id) category1.push({ path: row.path, sparkle_id: id });
    } catch {
      // skip unreadable / missing files (legitimate non-Sparkle .md)
    }
  }

  const orphans = sqlite
    .prepare(
      `SELECT iv.id, iv.title, iv.export_path
         FROM items_vault iv
         WHERE NOT EXISTS (
           SELECT 1 FROM vault_files vf WHERE vf.sparkle_id = iv.id
         )`,
    )
    .all() as Category2[];

  const totalVault = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM items_vault").get() as { c: number }
  ).c;
  const totalFiles = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM vault_files").get() as { c: number }
  ).c;

  if (totalVault === 0 && totalFiles === 0) {
    console.log("✅ Empty vault — nothing to audit. v24 ready to run.\n");
    writeReport({
      generated_at: new Date().toISOString(),
      category_1_backfillable: [],
      category_2_orphans_unresolved: [],
      category_2_resolved: [],
      ready_for_v24: true,
    });
    process.exit(0);
  }

  console.log(`📊 vault_files: ${totalFiles}`);
  console.log(`📊 items_vault: ${totalVault}`);
  console.log(
    `📊 Category A (NULL sparkle_id but frontmatter has one): ${category1.length} — v24 will backfill`,
  );
  console.log(`📊 Category B (orphans, no vault_files match): ${orphans.length}\n`);

  if (orphans.length === 0 && category1.length === 0) {
    console.log("✅ No issues — v24 ready to run.\n");
    writeReport({
      generated_at: new Date().toISOString(),
      category_1_backfillable: [],
      category_2_orphans_unresolved: [],
      category_2_resolved: [],
      ready_for_v24: true,
    });
    process.exit(0);
  }

  const resolutions: Array<{ id: string; resolution: "archive" | "skip" }> = [];
  const unresolved: Category2[] = [];

  if (orphans.length > 0) {
    if (args.batch === "archive-all") {
      console.log(`⚙️  --batch=archive-all: marking all ${orphans.length} orphans for archive\n`);
      for (const o of orphans) resolutions.push({ id: o.id, resolution: "archive" });
    } else if (args.batch === "skip-all") {
      console.log(`⚙️  --batch=skip-all: deferring all ${orphans.length} orphans\n`);
      for (const o of orphans) resolutions.push({ id: o.id, resolution: "skip" });
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string) =>
        new Promise<string>((resolve) => rl.question(q, (a) => resolve(a.trim().toLowerCase())));

      console.log("🔧 Interactive resolution — for each orphan choose:");
      console.log("   (a) archive items_vault row  — Sparkle stops tracking, vault .md untouched");
      console.log("   (b) re-audit                  — you fixed frontmatter; rescan this row");
      console.log("   (c) skip                      — defer; recorded in pendings.json\n");

      for (let i = 0; i < orphans.length; i++) {
        const o = orphans[i]!;
        console.log(
          `\n[${i + 1}/${orphans.length}] id=${o.id} title=${JSON.stringify(o.title)} last-known-path=${o.export_path ?? "(null)"}`,
        );

        const ans = await ask("  choose (a/b/c) > ");
        if (ans === "a") {
          resolutions.push({ id: o.id, resolution: "archive" });
        } else if (ans === "b") {
          // Re-check whether frontmatter now has sparkle_id mapping
          const reMatch = sqlite
            .prepare("SELECT 1 FROM vault_files WHERE sparkle_id = ?")
            .get(o.id);
          if (reMatch) {
            console.log("  ✅ now resolvable — will not block v24");
          } else {
            console.log("  ⚠️  still no match — recording as skip");
            unresolved.push(o);
          }
        } else {
          unresolved.push(o);
        }
      }
      rl.close();
    }
  }

  const report: AuditReport = {
    generated_at: new Date().toISOString(),
    category_1_backfillable: category1,
    category_2_orphans_unresolved: unresolved,
    category_2_resolved: resolutions,
    ready_for_v24: unresolved.length === 0,
  };
  writeReport(report);

  if (resolutions.some((r) => r.resolution === "archive")) {
    console.log(
      "\n📌 To archive, run: npm run vault:reconcile -- --apply-from=scripts/vault-audit-report.json",
    );
  }

  if (unresolved.length > 0) {
    console.log(`\n⚠️  ${unresolved.length} orphans still unresolved — v24 will halt.`);
    process.exit(1);
  }

  console.log("\n✅ Audit complete — v24 ready.");
}

function writeReport(report: AuditReport): void {
  const outPath = "scripts/vault-audit-report.json";
  mkdirSync("scripts", { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n📝 Report: ${outPath}`);
}

// Re-export for tests / reuse
export { parseArgs };
export type { AuditReport };

// Allow direct invocation but skip when imported in tests
const isDirectInvocation = process.argv[1] && process.argv[1].endsWith("vault-audit.ts");
if (isDirectInvocation) {
  main().catch((e) => {
    console.error("vault:audit failed:", e);
    process.exit(1);
  });
}

void existsSync;
void readFileSync;
