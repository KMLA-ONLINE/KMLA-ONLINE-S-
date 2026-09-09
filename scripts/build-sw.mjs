// Generates build/client/sw.js from the finished SPA build.
//
// Runs after `react-router build` rather than as a Vite plugin: the SPA
// index.html is emitted by React Router's prerender pass, which completes after
// plugin `closeBundle` hooks, so a build-time plugin sees no files to precache.
// Operating on the final directory keeps the precache manifest honest.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSW } from "workbox-build";

// 앱 코드(`app/shared/lib/user-scoped-storage.ts`)가 계정 전환 때 이 캐시를 지운다.
// 이름이 갈라지면 보호된 이미지가 로그아웃 뒤에도 남으므로 양쪽이 같아야 한다.
const STORAGE_MEDIA_CACHE = "kmla-online-storage-media";

const clientDir = resolve(process.cwd(), "build/client");
const indexHtml = resolve(clientDir, "index.html");
const pushWorker = resolve(clientDir, "push-sw.js");

if (!existsSync(indexHtml)) {
  console.error(
    `[sw] ${indexHtml} not found. Run \`react-router build\` first (ssr must be false).`,
  );
  process.exit(1);
}

if (!existsSync(pushWorker)) {
  console.error(
    `[sw] ${pushWorker} not found. The Push companion must be included in the client build.`,
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
    "push-sw.js",
    "workbox-*.js",
    ".vite/**",
    "screenshots/**",
  ],
  importScripts: ["/push-sw.js"],
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
      // Storage 이미지. 여기가 모바일 데이터의 대부분이고, 캐시가 없으면 앱을 다시 열
      // 때마다 전부 다시 받는다 — signed URL은 서명할 때마다 토큰이 달라져 URL이 바뀌고,
      // URL이 바뀌면 `Cache-Control: 31536000`을 붙여 둬도 브라우저 캐시가 통째로 빗나가기
      // 때문이다. 그래서 토큰을 뗀 경로를 캐시 키로 쓴다(`cacheKeyWillBeUsed`). object
      // 경로는 UUID이고 업로드가 덮어쓰지 않으므로(`upsert: false`) 한 키가 나중에 다른
      // 내용을 가리키는 일이 없다.
      //
      // 이 캐시에는 보호된 이미지가 들어간다. 계정이 바뀌면
      // `syncUserScopedStorage()`가 통째로 지운다 — `docs/DATA_CACHE_POLICY.md` §1·§6.
      urlPattern: ({ url }) =>
        url.pathname.includes("/storage/v1/object/sign/"),
      handler: "CacheFirst",
      options: {
        cacheName: STORAGE_MEDIA_CACHE,
        plugins: [
          {
            cacheKeyWillBeUsed: async ({ request }) => {
              const url = new URL(request.url);
              url.search = "";
              return url.href;
            },
          },
        ],
        // 항목 수는 용량으로 환산해서 잡는다. 첨부 사진은 아직 원본(긴 변 3072px)
        // 그대로라 장당 수백 kB이므로, 150개면 최악의 경우 100 MB 근처다. 더 키우면
        // iOS의 origin 용량 상한에 먼저 부딪히고, 그때 `purgeOnQuotaError`가 캐시를
        // 통째로 비워 오히려 다시 받게 된다. 썸네일이 생기면 그때 올린다.
        expiration: {
          maxEntries: 150,
          maxAgeSeconds: 60 * 60 * 24 * 30,
          purgeOnQuotaError: true,
        },
        // 폰트와 달리 `0`(opaque)을 받지 않는다. opaque 응답은 성공과 403을 구분할 수
        // 없어서, 만료된 토큰으로 한 번 실패한 이미지가 30일 동안 깨진 채로 굳는다.
        // Storage가 `Access-Control-Allow-Origin: *`를 주므로 이미지에 `crossOrigin`을
        // 달아 실제 상태 코드를 보고 200만 캐시한다.
        cacheableResponse: { statuses: [200] },
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

if (
  !readFileSync(resolve(clientDir, "sw.js"), "utf8").includes("/push-sw.js")
) {
  console.error("[sw] generated sw.js did not import the Push companion.");
  process.exit(1);
}

for (const warning of warnings) console.warn(`[sw] ${warning}`);

console.log(
  `[sw] precached ${count} files (${(size / 1024).toFixed(1)} kB) -> build/client/sw.js`,
);
