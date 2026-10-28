import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

describe("health monitor notification retries", () => {
  let root: string;
  let flag: string;
  let attempts: string;
  let script: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sparkle-health-monitor-"));
    flag = join(root, "alert-sent");
    attempts = join(root, "push-attempts");
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    script = join(root, "scripts/health-monitor.sh");
    const source = readFileSync(
      resolve(import.meta.dirname, "../../../scripts/health-monitor.sh"),
      "utf8",
    );
    // Keep the real flag and LINE endpoint out of the test's side effects.
    expect(source).toContain("/tmp/sparkle-health-alert-sent");
    writeFileSync(script, source.replaceAll("/tmp/sparkle-health-alert-sent", flag));
    writeFileSync(
      join(root, ".env"),
      "LINE_CHANNEL_ACCESS_TOKEN=test-token\nLINE_ADMIN_USER_ID=test-user\n",
    );
    const curl = join(root, "bin/curl");
    writeFileSync(
      curl,
      `#!/bin/sh
case "$*" in
  *api.line.me*)
    printf 'push\\n' >> "$SPARKLE_TEST_PUSH_ATTEMPTS"
    exit "$SPARKLE_TEST_PUSH_EXIT"
    ;;
  *) exit "$SPARKLE_TEST_HEALTH_EXIT" ;;
esac
`,
    );
    chmodSync(curl, 0o755);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function check(healthy: boolean, delivered = true) {
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
        SPARKLE_TEST_PUSH_ATTEMPTS: attempts,
        SPARKLE_TEST_HEALTH_EXIT: healthy ? "0" : "22",
        SPARKLE_TEST_PUSH_EXIT: delivered ? "0" : "22",
      },
    });
    expect(result.error).toBeUndefined();
    return result;
  }

  function pushCount() {
    return existsSync(attempts) ? readFileSync(attempts, "utf8").trim().split("\n").length : 0;
  }

  it("stays silent when the service is healthy", () => {
    expect(check(true).status).toBe(0);
    expect(pushCount()).toBe(0);
    expect(existsSync(flag)).toBe(false);
  });

  it("retries failed outage alerts until delivery succeeds, then suppresses duplicates", () => {
    expect(check(false, false).status).toBe(1);
    expect(existsSync(flag)).toBe(false);
    expect(check(false, false).status).toBe(1);
    expect(pushCount()).toBe(2);
    expect(check(false).status).toBe(0);
    expect(existsSync(flag)).toBe(true);
    expect(check(false).status).toBe(0);
    expect(pushCount()).toBe(3);
  });

  it("retries failed recovery notifications before clearing the outage flag", () => {
    check(false);
    expect(existsSync(flag)).toBe(true);
    expect(check(true, false).status).toBe(1);
    expect(existsSync(flag)).toBe(true);
    expect(check(true).status).toBe(0);
    expect(existsSync(flag)).toBe(false);
    expect(check(true).status).toBe(0);
    expect(pushCount()).toBe(3);
  });

  it("sends a new alert for another outage after recovery", () => {
    check(false);
    check(true);
    check(false);
    expect(pushCount()).toBe(3);
    expect(existsSync(flag)).toBe(true);
  });
});
