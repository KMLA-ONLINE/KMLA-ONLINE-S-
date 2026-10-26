import { common } from "~/shared/i18n/en/common";

/**
 * 한국어 원문 → 영어. 화면 영역별 파일로 나눠 두고 여기서 합친다. 같은 원문이 두 파일에
 * 있으면 번역도 같아야 한다(`test/shared/i18n/translate.test.ts`가 확인한다).
 */
export const en: Readonly<Record<string, string>> = {
  ...common,
};
