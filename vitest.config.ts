import { globSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pureLayers = [
  "test/**/model/**/*.{test,spec}.ts",
  "test/**/data/**/*.{test,spec}.ts",
  "test/shared/lib/**/*.{test,spec}.ts",
  "test/routes/**/*.{test,spec}.ts",
  "test/eslint/**/*.{test,spec}.ts",
  "test/shared/service-worker/**/*.{test,spec}.ts",
];

const domDependent = [
  "test/features/posts/model/view-preference.test.ts",
  "test/features/search/model/recent-searches.test.ts",
  "test/routes/notification-open.test.ts",
  "test/shared/lib/user-scoped-storage.test.ts",
];

const nodeFiles = globSync(pureLayers)
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => !domDependent.includes(file));

const ignored = ["e2e/**", "node_modules/**", "build/**"];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    testTimeout: 10_000,
    css: false,
    pool: "vmThreads",

    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          isolate: true,
          globals: false,
          setupFiles: ["./test/setup.node.ts"],
          include: nodeFiles,
          exclude: ignored,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          isolate: true,
          globals: false,
          setupFiles: ["./test/setup.ts"],
          include: ["test/**/*.{test,spec}.{ts,tsx}"],
          exclude: [...ignored, ...nodeFiles],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["app/**/*.{ts,tsx}"],
      exclude: ["app/routes.ts", "app/**/+types/**"],
    },
  },
});
