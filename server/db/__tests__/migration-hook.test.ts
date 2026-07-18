import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "../../..");
const hookPath = join(repoRoot, "scripts/hooks/migration-safety.sh");
const preCommitPath = join(repoRoot, ".husky/pre-commit");
const prePushPath = join(repoRoot, ".husky/pre-push");
const migrationSource = readFileSync(join(repoRoot, "server/db/index.ts"), "utf8");
const targetMigrationVersion = migrationSource.match(/const TARGET_VERSION = (\d+);/)?.[1];
const tempDirs: string[] = [];

function makeFakeNpx(exitCode = 0, output = "") {
  const dir = mkdtempSync(join(tmpdir(), "sparkle-hook-test-"));
  tempDirs.push(dir);
  const logPath = join(dir, "npx.log");
  const executable = join(dir, "npx");
  writeFileSync(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$*" > "$SPARKLE_HOOK_TEST_LOG"\nprintf '%s' "$SPARKLE_HOOK_TEST_OUTPUT"\nexit "$SPARKLE_HOOK_TEST_EXIT"\n`,
  );
  chmodSync(executable, 0o755);
  return {
    dir,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      SPARKLE_HOOK_TEST_EXIT: String(exitCode),
      SPARKLE_HOOK_TEST_LOG: logPath,
      SPARKLE_HOOK_TEST_OUTPUT: output,
    },
    logPath,
  };
}

function runHook(toolInput: unknown, env: NodeJS.ProcessEnv) {
  return runScript(hookPath, JSON.stringify({ tool_input: toolInput }), env);
}

function runScript(path: string, input: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolveResult, reject) => {
      const childEnv = { ...env };
      delete childEnv.NODE_CHANNEL_FD;
      delete childEnv.NODE_OPTIONS;
      const child = spawn("bash", [path], {
        cwd: repoRoot,
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (status) => {
        resolveResult({ status, stdout, stderr });
      });
      child.stdin.end(input);
    },
  );
}

function makeFakeHookCommands(stagedFiles = "") {
  const dir = mkdtempSync(join(tmpdir(), "sparkle-husky-test-"));
  tempDirs.push(dir);
  const logPath = join(dir, "commands.log");
  for (const [name, content] of Object.entries({
    git: `if [ "$1" = branch ]; then echo fix/hook-safety; elif [ "$2" = --quiet ]; then exit "$SPARKLE_UNSTAGED_EXIT"; elif [ "$1" = diff ]; then printf '%s' "$SPARKLE_STAGED_FILES"; fi`,
    npx: `echo "npx $*" >> "$SPARKLE_HOOK_TEST_LOG"; if [ "$1" = lint-staged ]; then exit "$SPARKLE_LINT_EXIT"; fi; if [ "$1" = vitest ]; then exit "$SPARKLE_MIGRATION_EXIT"; fi`,
    npm: `echo "npm $*" >> "$SPARKLE_HOOK_TEST_LOG"`,
  })) {
    const executable = join(dir, name);
    writeFileSync(executable, `#!/bin/sh\n${content}\n`);
    chmodSync(executable, 0o755);
  }
  return {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      SPARKLE_HOOK_TEST_LOG: logPath,
      SPARKLE_STAGED_FILES: stagedFiles,
      SPARKLE_LINT_EXIT: "0",
      SPARKLE_MIGRATION_EXIT: "0",
      SPARKLE_UNSTAGED_EXIT: "0",
    },
    logPath,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Codex migration safety hook", () => {
  it("ignores object-shaped Claude tool input without reporting an error", async () => {
    const fake = makeFakeNpx();
    const result = await runHook({ file_path: "server/db/index.ts" }, fake.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(existsSync(fake.logPath)).toBe(false);
  });

  it("ignores apply_patch calls that do not touch the migration source", async () => {
    const fake = makeFakeNpx();
    const result = await runHook(
      "*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-old\n+new\n*** End Patch\n",
      fake.env,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(existsSync(fake.logPath)).toBe(false);
  });

  it.each(["Add", "Update", "Delete"])(
    "runs the migration suite for an apply_patch %s of server/db/index.ts",
    async (operation) => {
      const fake = makeFakeNpx();
      const result = await runHook(
        `*** Begin Patch\n*** ${operation} File: server/db/index.ts\n*** End Patch\n`,
        fake.env,
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(readFileSync(fake.logPath, "utf8")).toContain("vitest run");
      expect(readFileSync(fake.logPath, "utf8")).toContain(
        `migration-v${targetMigrationVersion}.test.ts`,
      );
    },
  );

  it("runs the migration suite when a file is moved to server/db/index.ts", async () => {
    const fake = makeFakeNpx();
    const result = await runHook(
      "*** Begin Patch\n*** Update File: server/db/next-index.ts\n*** Move to: server/db/index.ts\n*** End Patch\n",
      fake.env,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(readFileSync(fake.logPath, "utf8")).toContain(
      `migration-v${targetMigrationVersion}.test.ts`,
    );
  });

  it("returns structured agent feedback when migration checks fail", async () => {
    const fake = makeFakeNpx(1, "intentional migration failure");
    const result = await runHook(
      "*** Begin Patch\n*** Update File: server/db/index.ts\n*** End Patch\n",
      fake.env,
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      continue: true,
      systemMessage: "Migration checks failed after editing server/db/index.ts.",
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringContaining("intentional migration failure"),
      },
    });
  });

  it("keeps the target migration documented and covered by a dedicated test", () => {
    expect(targetMigrationVersion).toBeDefined();
    expect(existsSync(join(repoRoot, `docs/migration-v${targetMigrationVersion}.md`))).toBe(true);
    expect(
      existsSync(
        join(repoRoot, `server/db/__tests__/migration-v${targetMigrationVersion}.test.ts`),
      ),
    ).toBe(true);
  });

  it("does not use SELECT * as the source of an INSERT migration", () => {
    const source = readFileSync(join(repoRoot, "server/db/index.ts"), "utf8");
    const sqlBlocks = [...source.matchAll(/sqlite\.(?:exec|prepare)\(\s*`([\s\S]*?)`\s*\)/g)].map(
      (match) => match[1],
    );
    const unsafeStatements = sqlBlocks
      .flatMap((block) => block.split(";"))
      .filter((statement) => /INSERT\s+INTO\b[\s\S]*\bSELECT\s+\*/i.test(statement));

    expect(unsafeStatements).toEqual([]);
  });

  it.each([
    ["does not run migration tests without a staged migration", "src/App.tsx\n", "0", false],
    ["runs migration tests for a staged migration", "server/db/index.ts\n", "0", true],
    ["blocks a commit when migration tests fail", "server/db/index.ts\n", "1", true],
  ])("%s", async (_name, stagedFiles, migrationExit, shouldRunMigration) => {
    const fake = makeFakeHookCommands(stagedFiles);
    fake.env.SPARKLE_MIGRATION_EXIT = migrationExit;
    const result = await runScript(preCommitPath, "", fake.env);
    const log = readFileSync(fake.logPath, "utf8");

    expect(log.includes("npx vitest run")).toBe(shouldRunMigration);
    expect(result.status).toBe(migrationExit === "0" ? 0 : 1);
  });

  it("blocks a commit immediately when lint-staged fails", async () => {
    const fake = makeFakeHookCommands();
    fake.env.SPARKLE_LINT_EXIT = "1";
    const result = await runScript(preCommitPath, "", fake.env);

    expect(result.status).toBe(1);
    expect(readFileSync(fake.logPath, "utf8").trim()).toBe("npx lint-staged");
  });

  it("blocks a partially staged migration", async () => {
    const fake = makeFakeHookCommands("server/db/index.ts\n");
    fake.env.SPARKLE_UNSTAGED_EXIT = "1";
    const result = await runScript(preCommitPath, "", fake.env);

    expect(result.status).toBe(1);
    expect(readFileSync(fake.logPath, "utf8")).not.toContain("npx vitest run");
  });

  it("reports malformed PostToolUse JSON instead of silently passing", async () => {
    const result = await runScript(hookPath, "{malformed", process.env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unable to parse PostToolUse input");
  });

  it("reports repository resolution failures instead of silently passing", async () => {
    const fake = makeFakeNpx();
    const git = join(fake.dir, "git");
    writeFileSync(git, "#!/bin/sh\nexit 1\n");
    chmodSync(git, 0o755);
    const result = await runHook(
      "*** Begin Patch\n*** Update File: server/db/index.ts\n*** End Patch\n",
      fake.env,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unable to resolve repository root");
  });

  it.each([
    ["allows a feature branch update", "refs/heads/topic a refs/heads/topic b\n", 0],
    ["blocks an explicit main target", "HEAD a refs/heads/main b\n", 1],
    [
      "blocks main when it appears after another ref",
      "refs/heads/topic a refs/heads/topic b\nHEAD c refs/heads/main d\n",
      1,
    ],
  ])("%s", async (_name, input, expectedStatus) => {
    const result = await runScript(prePushPath, input, process.env);
    expect(result.status).toBe(expectedStatus);
  });
});
