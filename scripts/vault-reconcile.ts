#!/usr/bin/env tsx
/**
 * vault:reconcile — Resolve crash-window orphan .md files (export wrote disk
 * but DB transaction failed) and apply audit decisions from vault:audit report.
 *
 * Two operation modes:
 *
 *   (1) --apply-from=<report.json>
 *       Read scripts/vault-audit-report.json (or other path) and execute the
 *       category_2_resolved decisions: 'archive' → DELETE items_vault row but
 *       leave .md untouched (vault is content source of truth).
 *
 *   (2) Default (interactive)
 *       Find vault_files rows with sparkle_id pointing at items_active rows
 *       (= disk has .md but DB never committed items_vault). Operator chooses
 *       (a) re-promote items_active → items_vault using existing snippet,
 *       (b) delete on-disk .md, (c) skip.
 *
 * Usage:
 *   npm run vault:reconcile
 *   npm run vault:reconcile -- --apply-from=scripts/vault-audit-report.json
 *   npm run vault:reconcile -- --batch=skip-all
 *   npm run vault:reconcile -- --help
 */

import { readFileSync, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import readline from "node:readline";
import Database from "better-sqlite3";

const HELP = `
vault:reconcile — Crash-window orphan resolver + audit-report applier

Modes:
  --apply-from=<report.json>   Apply decisions recorded by vault:audit
  --batch=skip-all             Skip every interactive prompt
  --help

What it fixes:
  Export crash window: disk .md written, DB INSERT failed → items_active still
  exists, on-disk .md has sparkle_id frontmatter pointing at it. PR 2's
  pre-check guard refuses re-export of these. This CLI is the operator path.

Recovery options per row:
  (a) Re-promote items_active → items_vault using current snippet
  (b) Delete the on-disk .md (only the duplicate / abandoned export)
  (c) Skip (defer)
`;

type Args = {
  help: boolean;
  applyFrom: string | null;
  batch: "skip-all" | null;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { help: false, applyFrom: null, batch: null };
  for (const a of argv.slice(2)) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--apply-from=")) out.applyFrom = a.slice("--apply-from=".length);
    else if (a === "--batch=skip-all") out.batch = "skip-all";
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

type AuditReportShape = {
  category_2_resolved?: Array<{ id: string; resolution: "archive" | "skip" }>;
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

  // Reconcile MUST write — open RW
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");

  if (args.applyFrom) {
    if (!existsSync(args.applyFrom)) {
      console.error(`✗ Report not found: ${args.applyFrom}`);
      process.exit(1);
    }
    const raw: unknown = JSON.parse(readFileSync(args.applyFrom, "utf-8"));
    const report = (raw && typeof raw === "object" ? raw : {}) as AuditReportShape;
    const resolutions = report.category_2_resolved ?? [];
    if (resolutions.length === 0) {
      console.log("ℹ️  No resolutions to apply.");
      process.exit(0);
    }

    let archived = 0;
    let skipped = 0;
    const stmt = sqlite.prepare("DELETE FROM items_vault WHERE id = ?");
    const tx = sqlite.transaction((rows: typeof resolutions) => {
      for (const r of rows) {
        if (r.resolution === "archive") {
          stmt.run(r.id);
          archived++;
        } else {
          skipped++;
        }
      }
    });
    tx(resolutions);
    console.log(`✅ Applied: ${archived} archived, ${skipped} skipped`);
    process.exit(0);
  }

  // Interactive crash-window orphan recovery
  const orphans = sqlite
    .prepare(
      `SELECT vf.path AS vault_path, vf.sparkle_id, ia.id AS active_id, ia.title, ia.status
         FROM vault_files vf
         JOIN items_active ia ON ia.id = vf.sparkle_id
         WHERE vf.sparkle_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM items_vault iv WHERE iv.id = vf.sparkle_id)`,
    )
    .all() as Array<{
    vault_path: string;
    sparkle_id: string;
    active_id: string;
    title: string;
    status: string;
  }>;

  if (orphans.length === 0) {
    console.log("✅ No crash-window orphans found.");
    process.exit(0);
  }

  console.log(`🔧 ${orphans.length} crash-window orphan(s) detected.\n`);

  const vaultRoot = (
    sqlite.prepare("SELECT value FROM settings WHERE key = ?").get("obsidian_vault_path") as
      | { value: string }
      | undefined
  )?.value;

  if (args.batch === "skip-all") {
    console.log("⚙️  --batch=skip-all: deferring all orphans");
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) =>
    new Promise<string>((resolve) => rl.question(q, (a) => resolve(a.trim().toLowerCase())));

  let promoted = 0;
  let deleted = 0;
  let skipped = 0;

  for (let i = 0; i < orphans.length; i++) {
    const o = orphans[i]!;
    console.log(
      `\n[${i + 1}/${orphans.length}] active_id=${o.active_id} status=${o.status} title=${JSON.stringify(o.title)}`,
    );
    console.log(`  on-disk: ${o.vault_path}`);

    const ans = await ask("  (a) promote, (b) delete .md, (c) skip > ");

    if (ans === "a") {
      const active = sqlite.prepare("SELECT * FROM items_active WHERE id = ?").get(o.active_id) as
        | {
            title: string;
            category_id: string | null;
            tags: string;
            aliases: string;
            source: string | null;
            origin: string | null;
            created: string;
            is_private: number;
            content: string | null;
          }
        | undefined;
      if (!active) {
        console.log("  ⚠️  items_active row missing — skipping");
        skipped++;
        continue;
      }
      const snippet = (active.content ?? "").substring(0, 500);
      const exportedAt = new Date().toISOString();
      const tx = sqlite.transaction(() => {
        sqlite
          .prepare(
            `INSERT INTO items_vault (
               id, title, category_id, tags, aliases, source, origin,
               export_path, exported_at, created, is_private, content_snippet
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            o.active_id,
            active.title,
            active.category_id,
            active.tags,
            active.aliases,
            active.source,
            active.origin,
            o.vault_path,
            exportedAt,
            active.created,
            active.is_private,
            snippet,
          );
        sqlite.prepare("DELETE FROM items_active WHERE id = ?").run(o.active_id);
      });
      tx();
      promoted++;
    } else if (ans === "b") {
      if (!vaultRoot) {
        console.log("  ⚠️  obsidian_vault_path not set — cannot delete file. Skipping.");
        skipped++;
        continue;
      }
      try {
        await unlink(join(vaultRoot, o.vault_path));
        sqlite.prepare("DELETE FROM vault_files WHERE path = ?").run(o.vault_path);
        deleted++;
      } catch (e) {
        console.log(`  ⚠️  unlink failed: ${(e as Error).message}`);
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  rl.close();
  console.log(`\n✅ Reconcile done — promoted ${promoted}, deleted ${deleted}, skipped ${skipped}`);
}

const isDirect = process.argv[1] && process.argv[1].endsWith("vault-reconcile.ts");
if (isDirect) {
  main().catch((e) => {
    console.error("vault:reconcile failed:", e);
    process.exit(1);
  });
}
