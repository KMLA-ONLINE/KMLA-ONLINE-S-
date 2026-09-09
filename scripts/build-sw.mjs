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
      // `destination`까지 보는 이유가 둘 있다.
      //
      // 하나는 post-attachments 버킷이 이미지 전용이 아니라는 것이다. MIME 제한이 없고
      // 상한이 30 MB라 pdf·hwp가 같은 경로로 나간다. 첨부 다운로드까지 담으면 한 번 받고
      // 마는 파일이 캐시를 차지하고, 용량 상한에 부딪히면 `purgeOnQuotaError`가 이미지까지
      // 통째로 버린다.
      //
      // 다른 하나가 더 중요하다. 첨부 다운로드 링크는 같은 URL에 `?download=<파일명>`을
      // 붙여 `Content-Disposition`을 받는데, 아래 `cacheKeyWillBeUsed`가 쿼리를 통째로
      // 떼므로 인라인 이미지와 다운로드가 **같은 키로 겹친다.** 그대로 두면 본문에서 이미
      // 본 이미지를 다운로드할 때 헤더 없는 응답이 캐시에서 나와 파일로 저장되지 않는다.
      // `<img>`는 언제나 `download` 없는 URL을 쓰므로, destination으로 가르면 키가 겹칠
      // 일이 없다.
      urlPattern: ({ url, request }) =>
        request.destination === "image" &&
        url.pathname.includes("/storage/v1/object/sign/"),
      handler: "CacheFirst",
      options: {
        cacheName: STORAGE_MEDIA_CACHE,
        // `ExpirationPlugin`을 쓰지 않는다. 그 플러그인은 타임스탬프를 `request.url`로
        // 기록하고 만료시킬 때 `cache.delete(request.url)`을 부르는데, 우리 캐시 키는
        // 토큰을 뗀 URL이라 **둘이 영영 만나지 않는다.** 그대로 두면 `maxEntries`도
        // `maxAgeSeconds`도 한 건도 지우지 못하고, 캐시는 origin 용량 상한까지 자란다.
        // (덤으로 그 플러그인은 토큰이 붙은 URL을 IndexedDB에 남긴다.)
        //
        // 그래서 상한은 같은 키로 직접 건다. `cache.keys()`는 넣은 순서대로 돌려주므로
        // 가장 오래 전에 넣은 것부터 버린다. LRU는 아니지만, 경로가 불변이라 잘못 버려도
        // 다음에 다시 받는 것뿐이고 추가 장부가 필요 없다.
        //
        // 150이라는 수는 용량으로 환산한 값이다. 첨부 사진은 아직 원본(긴 변 3072px)
        // 그대로라 장당 수백 kB이므로 최악의 경우 100 MB 근처다. 썸네일이 생기면 올린다.
        plugins: [
          {
            cacheKeyWillBeUsed: async ({ request }) => {
              const url = new URL(request.url);
              url.search = "";
              return url.href;
            },
            cacheDidUpdate: async ({ cacheName }) => {
              // 이 함수 본문은 여기서 실행되지 않는다. workbox-build가 문자열로 굳혀
              // sw.js에 넣으므로 `caches`는 Service Worker 전역이다. 이 파일의 나머지는
              // Node라서 ESLint가 `globals.node`로 본다.
              // eslint-disable-next-line no-undef
              const cache = await caches.open(cacheName);
              const keys = await cache.keys();
              const overflow = keys.length - 150;

              for (let index = 0; index < overflow; index += 1) {
                await cache.delete(keys[index]);
              }
            },
          },
        ],
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
