import { createContext, use } from "react";

import { useT } from "~/shared/i18n";

/**
 * 서명 URL을 뒤에서 채우는 화면(홈 피드 카드)만 `true`로 감싼다. 그 안에서는 URL이 없는 미디어를
 * 실패 대신 로딩으로 그린다. 기본값은 실패 표현이라 다른 화면은 감싸지 않아도 된다.
 */
export const MediaPendingContext = createContext(false);

/** URL이 없는 미디어 자리의 안내 문구. 로딩과 실패 문구를 화면마다 따로 쓰지 않는다. */
export function useUnavailableMediaLabel(kind: "image" | "file"): string {
  const pending = use(MediaPendingContext);
  const t = useT();
  if (kind === "file")
    return pending ? t("파일 준비 중") : t("다운로드할 수 없음");
  return pending ? t("이미지 불러오는 중") : t("이미지를 불러오지 못했습니다");
}
