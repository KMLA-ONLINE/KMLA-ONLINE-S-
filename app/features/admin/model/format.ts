import type { AdminApplication } from "~/features/admin/model/types";
import { translate, type Locale } from "~/shared/i18n";

export function formatProfileType(type: string, locale: Locale = "ko"): string {
  return translate(
    locale,
    type === "student" ? "재학생" : type === "teacher" ? "교사" : "졸업생",
  );
}

export function formatApplicationField(
  value: AdminApplication[keyof AdminApplication],
  locale: Locale = "ko",
): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean")
    return translate(locale, value ? "예" : "아니요");
  if (value === "domestic") return translate(locale, "국내반");
  if (value === "international") return translate(locale, "국제반");
  if (value === "male") return translate(locale, "남성");
  if (value === "female") return translate(locale, "여성");
  return String(value);
}
