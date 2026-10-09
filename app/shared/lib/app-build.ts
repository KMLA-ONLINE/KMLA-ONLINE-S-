import { getKoreaDateIso } from "~/shared/lib/korea-date";

interface AppBuild {
  /** 짧은 커밋 해시. 커밋을 읽지 못한 빌드는 null이다. */
  commit: string | null;
  /** 빌드한 순간(ISO). */
  builtAt: string;
}

// `vite.config.ts`가 빌드 때 채운다. Vitest는 그 설정을 읽지 않으므로 없을 수 있다.
declare const __APP_BUILD__: AppBuild | undefined;

export const appBuild: AppBuild | null =
  typeof __APP_BUILD__ === "undefined" ? null : __APP_BUILD__;

/** "2026.10.09 · 0c3a00a". 날짜는 학교 기준인 한국 날짜다. */
export function formatAppBuild(build: AppBuild | null): string {
  if (!build) return "알 수 없음";
  const date = getKoreaDateIso(new Date(build.builtAt)).replaceAll("-", ".");
  return build.commit ? `${date} · ${build.commit}` : date;
}
