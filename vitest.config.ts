import { globSync } from "node:fs";

import { defineConfig } from "vitest/config";

// Deliberately does NOT include the `reactRouter()` Vite plugin: it builds a
// full framework graph (typegen, virtual server modules) that does not work
// under Vitest. Unit tests import route modules and components directly and
// wrap them with `createRoutesStub` from `react-router` when routing context
// is needed. End-to-end coverage lives in Playwright instead.

// Building a jsdom window costs about 1.3s per test file and dominates the run,
// far outweighing the tests themselves. `model/`, `data/` and `shared/lib/` hold
// pure logic that never touches the DOM, so they run in Node instead.
//
// Route modules are the other half: a `clientLoader`/`clientAction` test calls a
// function and asserts on what it returned, so the whole `test/routes/**` tree is
// pure too unless it renders. The few route tests that do render are listed in
// `domDependent` below.
const pureLayers = [
  "test/**/model/**/*.{test,spec}.ts",
  "test/**/data/**/*.{test,spec}.ts",
  "test/shared/lib/**/*.{test,spec}.ts",
  "test/routes/**/*.{test,spec}.ts",
  "test/eslint/**/*.{test,spec}.ts",
  "test/shared/service-worker/**/*.{test,spec}.ts",
];

// Files inside those layers that read browser APIs directly and need jsdom
// anyway. Add to this list rather than moving the test out of its layer.
//
// The globs above deliberately cover `.ts` only: a route test that renders needs
// JSX, so it is a `.tsx` file and lands in the jsdom project on its extension.
const domDependent = [
  "test/features/posts/model/view-preference.test.ts",
  "test/features/search/model/recent-searches.test.ts",
  "test/routes/notification-open.test.ts",
];

// Resolved once so both projects agree on the split. Globbing rather than
// handing `pureLayers` to the jsdom project's `exclude` is deliberate: Vitest
// applies `exclude` after `include` and supports no negation, so a `domDependent`
// entry excluded by a `pureLayers` glob would be dropped by both projects.
const nodeFiles = globSync(pureLayers)
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => !domDependent.includes(file));

const ignored = ["e2e/**", "node_modules/**", "build/**"];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // 전체 병렬 실행 시 Windows의 jsdom 파일들이 CPU를 나눠 쓰며 5초를 간헐적으로 넘긴다.
    testTimeout: 10_000,
    // Forks — Vitest's default — pay a process spawn per test file, which on
    // Windows costs about as much as the rest of the run combined.
    pool: "threads",
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          pool: "threads",
          // Explicit imports instead of globals so Vitest's `expect` and
          // Playwright's `expect` can coexist under a single tsconfig.
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
          pool: "threads",
          globals: false,
          setupFiles: ["./test/setup.ts"],
          include: ["test/**/*.{test,spec}.{ts,tsx}"],
          exclude: [...ignored, ...nodeFiles],
          css: true,
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
