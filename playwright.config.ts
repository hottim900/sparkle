import { defineConfig } from "@playwright/test";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/sparkle-e2e-test.db";
const AUTH_TOKEN = "e2e-test-token-that-is-long-enough-for-validation";
const PORT = 3456;

// Clean up test DB before run
try {
  unlinkSync(TEST_DB);
} catch {
  // File may not exist
}
try {
  unlinkSync(TEST_DB + "-wal");
} catch {
  // File may not exist
}
try {
  unlinkSync(TEST_DB + "-shm");
} catch {
  // File may not exist
}

export { AUTH_TOKEN };

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npx tsx server/index.ts`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_TOKEN,
      DATABASE_URL: TEST_DB,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOST: "127.0.0.1",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
