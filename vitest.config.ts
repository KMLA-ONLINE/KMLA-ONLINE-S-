import { defineConfig } from "vitest/config";

// Deliberately does NOT include the `reactRouter()` Vite plugin: it builds a
// full framework graph (typegen, virtual server modules) that does not work
// under Vitest. Unit tests import route modules and components directly and
// wrap them with `createRoutesStub` from `react-router` when routing context
// is needed. End-to-end coverage lives in Playwright instead.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    // Explicit imports instead of globals so Vitest's `expect` and Playwright's
    // `expect` can coexist under a single tsconfig without clashing.
    globals: false,
    setupFiles: ["./test/setup.ts"],
    include: [
      "app/**/*.{test,spec}.{ts,tsx}",
      "test/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["e2e/**", "node_modules/**", "build/**"],
    css: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["app/**/*.{ts,tsx}"],
      exclude: [
        "app/**/*.{test,spec}.{ts,tsx}",
        "app/routes.ts",
        "app/**/+types/**",
      ],
    },
  },
});
