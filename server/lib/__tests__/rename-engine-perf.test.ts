import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, insertActiveRow } from "../../test-utils.js";
import { applyTitleRename } from "../rename-engine.js";

/**
 * ENG-8 perf gate: 50-item rename sweep P99 < 500ms.
 *
 * Catches regressions that would make hub-note renames feel sluggish.
 * The gate is conservative — typical sync rename should be <50ms; 500ms
 * is the "user notices and gets nervous" threshold (after which the
 * design doc calls for moving to a background job, line 204-205).
 *
 * If this test starts failing, profile applyTitleRename's reference_index
 * fetch + rewriteWikilinks loop before raising the threshold.
 */
describe("ENG-8 rename engine perf gate", () => {
  it("50-item rename sweep stays under 500ms (P99 over 11 runs)", () => {
    const samples: number[] = [];
    const TRIALS = 11; // odd so the median index is well-defined

    for (let trial = 0; trial < TRIALS; trial++) {
      const { sqlite } = createTestDb();
      const targetId = insertActiveRow(sqlite, { title: `Target-${trial}` });
      const insertRef = sqlite.prepare(
        `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title, kind)
         VALUES (?, ?, ?, ?, 'wikilink')`,
      );
      // 50 sources each citing Target once. Manual INSERT for both the
      // source row + the reference_index entry; bypasses reindexItemReferences
      // so we only measure the rename engine itself.
      const sourceIds: string[] = [];
      for (let i = 0; i < 50; i++) {
        const id = randomUUID();
        sourceIds.push(id);
        sqlite
          .prepare(
            `INSERT INTO items_active (id, type, status, title, content, created, modified)
             VALUES (?, 'note', 'fleeting', ?, ?, '2026-01-01', '2026-01-01')`,
          )
          .run(id, `Source ${i}`, `body [[Target-${trial}]] tail ${i}`);
        insertRef.run(id, targetId, 5, `Target-${trial}`);
      }

      const t0 = performance.now();
      const result = applyTitleRename(sqlite, targetId, `Target-${trial}`, `Renamed-${trial}`);
      const elapsed = performance.now() - t0;
      samples.push(elapsed);

      // Sanity: actually swept all 50
      expect(result.rewrittenCount).toBe(50);
    }

    samples.sort((a, b) => a - b);
    // P99 of 11 samples = the top sample. Allow that (worst observed) to
    // drive the gate so we catch tail-latency regressions, not just median.
    const p99 = samples[samples.length - 1]!;
    const p50 = samples[Math.floor(samples.length / 2)]!;

    expect(p50).toBeLessThan(500);
    expect(p99).toBeLessThan(500);
  });
});
