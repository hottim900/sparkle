import { describe, it } from "vitest";
// TODO: Full rewrite needed after schema split. Pre-split tests exercised the
// LINE-command "已匯出" guard by creating items with status='exported' in the
// items table — no longer valid: status='exported' is rejected by the new
// items_active CHECK constraint, and exported rows live in items_vault. The
// guard is now enforced one level up at the route / getItem(origin==='vault')
// layer; see route-layer tests. This file is disabled pending that rewrite.

describe.skip("LINE item-handlers — vault-origin guard (placeholder)", () => {
  it.skip("TODO: rewrite to insert into items_vault and assert on new guard", () => {});
});
