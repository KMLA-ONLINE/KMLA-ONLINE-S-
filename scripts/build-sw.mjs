// Generates build/client/sw.js from the finished SPA build.
//
// Runs after `react-router build` rather than as a Vite plugin: the SPA
// index.html is emitted by React Router's prerender pass, which completes after
// plugin `closeBundle` hooks, so a build-time plugin sees no files to precache.
// Operating on the final directory keeps the precache manifest honest.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateSW } from "workbox-build";

const clientDir = resolve(process.cwd(), "build/client");
const indexHtml = resolve(clientDir, "index.html");

if (!existsSync(indexHtml)) {
  console.error(
    `[sw] ${indexHtml} not found. Run \`react-router build\` first (ssr must be false).`,
  );
  process.exit(1);
}

const { count, size, warnings } = await generateSW({
  globDirectory: clientDir,
  swDest: resolve(clientDir, "sw.js"),
  // Fonts are deliberately absent: Pretendard ships every Hangul glyph in one
  // ~750 kB file, which would more than double what a first-time visitor has to
  // download before the app is installable. They are runtime-cached instead
  // (see below), so the first render may fall back to a system font once.
  globPatterns: ["**/*.{html,js,css,ico,png,svg,webmanifest}"],
  // sw.js registers itself; the Vite manifest is a build artifact.
  // Promotional screenshots are only needed when the browser expands its
  // install UI; downloading them with the offline app shell wastes bandwidth.
  globIgnores: [
    "sw.js",
    "workbox-*.js",
    ".vite/**",
    "screenshots/**",
    "twemoji/15.0.0/**",
  ],
  runtimeCaching: [
    {
      // Vite content-hashes font filenames, so a cached entry can never go
      // stale — CacheFirst with a long TTL is safe. maxEntries bounds the
      // leftovers from previous deploys.
      urlPattern: /\.woff2$/,
      handler: "CacheFirst",
      options: {
        cacheName: "fonts",
        expiration: {
          maxEntries: 20,
          maxAgeSeconds: 60 * 60 * 24 * 365,
        },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      urlPattern: /\/twemoji\/15\.0\.0\/[0-9a-f-]+\.svg$/,
      handler: "CacheFirst",
      options: {
        cacheName: "twemoji-15.0.0",
        expiration: {
          maxEntries: 500,
          maxAgeSeconds: 60 * 60 * 24 * 365,
        },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],
  // App-shell routing: any navigation the SW cannot match falls back to the
  // precached index.html, which is what makes deep links work offline.
  navigateFallback: "/index.html",
  navigateFallbackDenylist: [/^\/api\//],
  // Vite already content-hashes everything under /assets, so a revision query
  // param would only bust the cache for no reason.
  dontCacheBustURLsMatching: /^assets\//,
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  // The app prompts before activating; see app/pwa/use-service-worker.ts.
  skipWaiting: false,
  sourcemap: false,
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});

for (const warning of warnings) console.warn(`[sw] ${warning}`);

console.log(
  `[sw] precached ${count} files (${(size / 1024).toFixed(1)} kB) -> build/client/sw.js`,
);
