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
  globPatterns: ["**/*.{html,js,css,ico,png,svg,webmanifest,woff2}"],
  // sw.js registers itself; the Vite manifest is a build artifact.
  globIgnores: ["sw.js", "workbox-*.js", ".vite/**"],
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
