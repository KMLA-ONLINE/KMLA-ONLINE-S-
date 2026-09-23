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
  // install UI, and og-image.png is only ever fetched by link-preview
  // crawlers; downloading either with the offline app shell wastes bandwidth.
  // badge-96x96.png is deliberately absent from this list — the Push handler
  // draws it on every notification, including while the app is offline.
  globIgnores: [
    "sw.js",
    "push-sw.js",
    "workbox-*.js",
    ".vite/**",
    "screenshots/**",
    "og-image.png",
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
      // URL이 바뀌면 `Cache-Control: 86400`을 붙여 둬도 브라우저 캐시가 통째로 빗나가기
      // 때문이다. 그래서 토큰을 뗀 경로를 캐시 키로 쓴다(`cacheKeyWillBeUsed`). object
      // 경로는 UUID이고 업로드가 덮어쓰지 않으므로(`upsert: false`) 한 키가 나중에 다른
      // 내용을 가리키는 일이 없다.
      //
      // 이 캐시에는 보호된 이미지가 들어간다. 계정이 바뀌면
      // `syncUserScopedStorage()`가 통째로 지운다 — `docs/DATA_CACHE_POLICY.md` §1·§6.
      // signed URL을 가진 탭 밖 요청이 같은 token-less 키를 읽지 못하도록 `<img>` 요청만
      // 받는다. 이 제한은 권한 회수 뒤 24시간인 로컬 이미지 보관 경계에도 필요하다.
      //
      // 1. `download` 파라미터가 붙은 URL은 제외한다. 첨부 다운로드 링크는 같은 URL에
      //    `?download=<파일명>`을 붙여 `Content-Disposition`을 받는데, 아래
      //    `cacheKeyWillBeUsed`가 쿼리를 통째로 떼므로 인라인 이미지와 **같은 키로 겹친다.**
      //    그대로 두면 본문에서 이미 본 이미지를 다운로드할 때 헤더 없는 응답이 캐시에서
      //    나와 파일로 저장되지 않는다. `<img>`는 언제나 `download` 없는 URL을 쓴다.
      // 2. 응답의 `content-type`이 이미지인 것만 담는다(`cacheWillUpdate`). post-attachments
      //    버킷은 MIME 제한이 없고 상한이 30 MB라 pdf·hwp가 같은 경로로 나가는데, 한 번
      //    받고 마는 파일이 캐시를 차지할 이유가 없다. opaque 응답은 헤더가 비어 있어 이
      //    검사에서 저절로 떨어진다 — 성공과 403을 구분할 수 없는 응답을 캐시에 남기지
      //    않는다.
      urlPattern: ({ request, url }) =>
        request.destination === "image" &&
        url.pathname.includes("/storage/v1/object/sign/") &&
        !url.searchParams.has("download"),
      handler: "CacheFirst",
      options: {
        cacheName: STORAGE_MEDIA_CACHE,
        // `ExpirationPlugin`을 쓰지 않는다. 그 플러그인은 타임스탬프를 `request.url`로
        // 기록하고 만료시킬 때 `cache.delete(request.url)`을 부르는데, 우리 캐시 키는
        // 토큰을 뗀 URL이라 **둘이 영영 만나지 않는다.** 그대로 두면 `maxEntries`도
        // `maxAgeSeconds`도 한 건도 지우지 못하고, 캐시는 origin 용량 상한까지 자란다.
        // (덤으로 그 플러그인은 토큰이 붙은 URL을 IndexedDB에 남긴다.)
        //
        // 그래서 상한은 같은 키로 직접 건다. 응답에 붙이는 저장 시각으로 24시간이 지난
        // entry는 읽기 전에 지우고, `cache.keys()`는 넣은 순서대로 돌려주므로 나머지는 가장
        // 오래 전에 넣은 것부터 버린다. LRU는 아니지만, 경로가 불변이라 잘못 버려도 다음에
        // 다시 받는 것뿐이고 추가 장부가 필요 없다.
        //
        // 300이라는 수는 용량으로 환산한 값이다. 축소본은 서버가 1MiB 이하로만 확정하고,
        // 그보다 큰 원본·커버는 아예 넣지 않으므로 최악의 경우도 약 300MiB다. 이 숫자와
        // byte 상한은 아래 플러그인 안에도 그대로 적혀 있어야 한다 — 함수는 문자열로 굳어
        // sw.js에 들어가므로 이 파일의 상수를 참조할 수 없다.
        plugins: [
          {
            cachedResponseWillBeUsed: async ({
              cacheName,
              request,
              cachedResponse,
            }) => {
              if (!cachedResponse) return null;

              const cachedAt = Number(
                cachedResponse.headers.get("x-kmla-storage-cached-at"),
              );
              if (
                !Number.isFinite(cachedAt) ||
                Date.now() - cachedAt > 24 * 60 * 60 * 1000
              ) {
                // workbox-build가 이 함수만 sw.js에 넣으므로 `caches`는 Service Worker
                // 전역이다. 이 파일의 나머지는 Node라 ESLint에는 직접 알려야 한다.
                // eslint-disable-next-line no-undef
                const cache = await caches.open(cacheName);
                const key = new URL(request.url);
                key.search = "";
                await cache.delete(key.href);
                return null;
              }

              return cachedResponse;
            },
            cacheKeyWillBeUsed: async ({ request }) => {
              const url = new URL(request.url);
              url.search = "";
              return url.href;
            },
            cacheWillUpdate: async ({ response }) => {
              if (
                response.status !== 200 ||
                !(response.headers.get("content-type") ?? "").startsWith(
                  "image/",
                )
              ) {
                return null;
              }

              const body = await response.clone().blob();
              if (body.size > 1024 * 1024) return null;

              const headers = new Headers(response.headers);
              headers.set("x-kmla-storage-cached-at", String(Date.now()));
              return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers,
              });
            },
            cacheDidUpdate: async ({ cacheName }) => {
              // 이 함수 본문은 여기서 실행되지 않는다. workbox-build가 문자열로 굳혀
              // sw.js에 넣으므로 `caches`는 Service Worker 전역이다. 이 파일의 나머지는
              // Node라서 ESLint가 `globals.node`로 본다.
              // eslint-disable-next-line no-undef
              const cache = await caches.open(cacheName);
              const keys = await cache.keys();
              const overflow = keys.length - 300;

              for (let index = 0; index < overflow; index += 1) {
                await cache.delete(keys[index]);
              }
            },
          },
        ],
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

// 캐시 이름이 두 파일에 각각 적혀 있다. 앱 쪽이 지우는 이름과 여기서 담는 이름이
// 갈라지면 계정을 바꿔도 이전 사용자의 보호된 이미지가 남는데, 그건 조용히 일어난다.
// 주석으로만 묶어 두지 않고 빌드에서 깨뜨린다.
const cachePurgeModule = resolve(
  process.cwd(),
  "app/shared/lib/user-scoped-storage.ts",
);

// 따옴표까지 포함해 정확히 같은 리터럴을 찾는다. 부분 문자열로 보면 이름 뒤에 무엇을
// 덧붙여도 통과해 버려 검사가 되지 않는다.
if (
  !readFileSync(cachePurgeModule, "utf8").includes(`"${STORAGE_MEDIA_CACHE}"`)
) {
  console.error(
    `[sw] ${cachePurgeModule} does not mention the "${STORAGE_MEDIA_CACHE}" cache. ` +
      "Account switches would stop purging cached Storage images.",
  );
  process.exit(1);
}

for (const warning of warnings) console.warn(`[sw] ${warning}`);

console.log(
  `[sw] precached ${count} files (${(size / 1024).toFixed(1)} kB) -> build/client/sw.js`,
);
