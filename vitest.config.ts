import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts", "src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/test-utils.{ts,tsx}",
        "**/test-setup.ts",
        "src/main.tsx",
        "src/sw.ts",
        "src/App.tsx",
        "src/vite-env.d.ts",
        "src/lib/api.ts",
        "src/components/ui/**",
        "server/instrument.ts",
        "server/test-utils.ts",
      ],
      // Vitest 4 uses more accurate V8 coverage remapping, producing lower
      // numbers than Vitest 3 for the same codebase. Thresholds adjusted accordingly.
      thresholds: {
        statements: 75,
        branches: 70,
      },
    },
    projects: [
      {
        test: {
          name: "server",
          include: ["server/**/*.test.ts"],
          environment: "node",
          globals: true,
        },
      },
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "frontend",
          include: ["src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test-setup.ts"],
        },
      },
    ],
  },
});
