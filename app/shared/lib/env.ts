/**
 * Typed access to the browser-visible environment.
 *
 * In SPA mode there is no server, so every value here ends up inside the
 * client bundle. Only ever put publishable/anon-grade values in `VITE_*`.
 *
 * Values are read lazily: a missing variable must fail where it is used, not
 * where this module is imported, so that route modules stay importable in unit
 * tests and during the build-time render of the root route.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl(): string {
    return required("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
  },
  get supabasePublishableKey(): string {
    return required(
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  /**
   * 배포 원본(`https://…`, 끝의 `/` 없이). 링크 미리보기 카드의 절대 URL을 만드는 데만
   * 쓴다.
   *
   * 없어도 앱은 정상 동작하므로 `required()`를 쓰지 않는다. 이 값이 없으면 미리보기
   * 이미지는 상대 경로로 나가고, 상대 경로를 풀지 못하는 크롤러에서만 이미지가 빠진다.
   * 다른 `VITE_*`와 달리 빌드 시점에 확정돼야 해서 런타임 `location`으로 대신할 수 없다
   * — 크롤러는 JavaScript를 실행하지 않는다.
   */
  get siteUrl(): string | null {
    const value = import.meta.env.VITE_SITE_URL?.trim();
    return value ? value.replace(/\/+$/, "") : null;
  },
};
