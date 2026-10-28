import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "../../..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Run the actual npm build entry point with an isolated Vite config. The config
// exits after probing deepmerge, before it can write frontend build artifacts.
function buildWithMerge(target: string, source: string) {
  const dir = mkdtempSync(join(tmpdir(), "sparkle-build-security-"));
  tempDirs.push(dir);
  const config = join(dir, "vite.config.mjs");
  writeFileSync(
    config,
    `import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(join(repoRoot, "package.json"))});
const merge = require("deepmerge");
try {
  const result = merge(${target}, ${source});
  if (result.sparkleBuildPoison === true) {
    console.error("prototype poisoning reached build");
    process.exit(42);
  }
  console.log("merge-safe:" + JSON.stringify(result));
  process.exit(0);
} catch (error) {
  if (error.code !== "ERR_PROTO_ACCESS") throw error;
  console.log("blocked:ERR_PROTO_ACCESS");
  process.exit(0);
}
export default {};
`,
  );
  const env = { ...process.env };
  // An inherited guard must not hide a regression in the npm build command.
  delete env.NODE_OPTIONS;
  delete env.NODE_CHANNEL_FD;
  const result = spawnSync("npm", ["run", "build", "--", "--config", config], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe("build dependency prototype safety", () => {
  const poisoned = `JSON.parse('{"__proto__":{"sparkleBuildPoison":true}}')`;

  it.each([
    ["target object", poisoned, "{}"],
    ["source with a null-prototype target", "Object.create(null)", poisoned],
  ])("does not inherit injected properties from a %s", (_name, target, source) => {
    const result = buildWithMerge(target, source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/blocked:ERR_PROTO_ACCESS|merge-safe:/);
  });

  it("preserves ordinary nested merges used by the build tools", () => {
    const result = buildWithMerge("{ nested: { a: 1 } }", "{ nested: { b: 2 } }");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('merge-safe:{"nested":{"a":1,"b":2}}');
  });
});
