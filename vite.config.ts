import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

/**
 * `VITE_SITE_URL`이 비어 있으면 Vercel이 빌드 환경에 넣어 주는 배포 도메인으로 채운다.
 *
 * 이 값은 링크 미리보기 카드의 `og:image`를 절대 URL로 만드는 데만 쓴다. 크롤러는
 * JavaScript를 실행하지 않아 런타임 `location`으로 대신할 수 없고, 상대 경로를 풀지 못하는
 * 수집기에서는 이미지가 빠진다. 그렇다고 사람이 스코프마다 도메인을 손으로 등록해야 하면
 * 그 등록이 빠진 배포가 조용히 상대 경로로 나간다.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL`은 Vercel이 바로 이 용도로 노출하는 값이고 Preview 빌드에도
 * 들어 있다. Preview가 production origin을 가리키게 되지만, 카드 이미지는 어느 환경이든
 * 같은 브랜드 카드 한 장이라 가리키는 곳이 달라도 결과가 같다.
 *
 * 명시적으로 넣은 값이 항상 이긴다 — `loadEnv`는 `.env` 파일과 `process.env`의 `VITE_` 값을
 * 모두 보므로, 둘 중 하나라도 있으면 여기서 손대지 않는다.
 */
function fillSiteUrlFromVercel(mode: string): void {
  if (loadEnv(mode, process.cwd(), "VITE_").VITE_SITE_URL) return;

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return;

  // 프로토콜은 빠져 있다.
  process.env.VITE_SITE_URL = `https://${host}`;
}

export default defineConfig(({ mode }) => {
  fillSiteUrlFromVercel(mode);

  return {
    plugins: [tailwindcss(), reactRouter()],
    resolve: {
      tsconfigPaths: true,
    },
  };
});

// The service worker is NOT generated here. React Router's SPA build runs as
// several Vite environments and writes build/client/index.html in a prerender
// pass that finishes after every plugin's `closeBundle` hook, so vite-plugin-pwa
// globs an empty directory (vite-pwa/vite-plugin-pwa#809). `scripts/build-sw.mjs`
// runs workbox-build against the finished output instead — see `npm run build`.
