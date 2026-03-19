/**
 * Thin re-export of node:fs functions used by vault.ts.
 * Exists solely to make these functions mockable in tests
 * (ESM native modules can't be mocked directly by Vitest).
 */
export {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
