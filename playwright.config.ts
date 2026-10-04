import { defineConfig, devices } from "@playwright/test";

// 127.0.0.1 rather than localhost on purpose: Firefox resolves `localhost` to
// ::1 first, while `vite preview` binds IPv4 only, so every navigation hangs.
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Every project shares one local Supabase database and the same seed users.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html"]] : [["html"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 15"] } },
  ],
  // Runs the real production SPA build (service worker included) rather than
  // the dev server, so what the tests exercise is what ships to Vercel.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command:
          "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
