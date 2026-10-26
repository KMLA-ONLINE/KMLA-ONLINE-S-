import { translate, type Locale } from "~/shared/i18n";

/** 기수 표기. 복학생은 `n.5기`로 적는다(§12.1). 기수가 없으면 `null`이라 대체 문구는 호출하는 쪽이 정한다. */
export function formatCohort(
  cohort: number | null,
  isReturningStudent: boolean,
  locale: Locale = "ko",
): string | null {
  if (cohort === null) return null;
  return translate(locale, "{cohort}기", {
    cohort: cohort + (isReturningStudent ? 0.5 : 0),
  });
}
