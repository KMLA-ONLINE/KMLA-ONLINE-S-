import { getKoreaDateIso } from "~/shared/lib/korea-date";

/**
 * `DateSelect`가 년/월/일 세 칸으로 흩어 놓은 값을 다시 `YYYY-MM-DD` 한 줄로 모은다.
 *
 * 폼이 밖으로 내보내는 값은 예전 `<input type="date">`와 같아야 한다. 검증도 저장도
 * 문자열 하나만 알면 되도록, 칸 이름 규칙과 조립 규칙을 이 파일에만 둔다.
 */
export interface DateParts {
  year: string;
  month: string;
  day: string;
}

const EMPTY_PARTS: DateParts = { year: "", month: "", day: "" };
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dateFieldNames(name: string) {
  return { year: `${name}Year`, month: `${name}Month`, day: `${name}Day` };
}

export function splitDateValue(value: string): DateParts {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return EMPTY_PARTS;

  return { year: match[1], month: match[2], day: match[3] };
}

export function joinDateParts({ year, month, day }: DateParts): string {
  if (!year || !month || !day) return "";

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** 월을 아직 고르지 않았다면 31일까지 열어 둔다. 뒤늦게 사라지는 선택지가 없어야 한다. */
export function daysInMonth(year: string, month: string): number {
  const monthNumber = Number(month);
  if (!monthNumber) return 31;

  // 연도를 모를 때는 윤년으로 친다. 2월 29일생이 연도를 먼저 고르도록 강요받지 않는다.
  const yearNumber = Number(year) || 2000;
  return new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();
}

export function readDateField(formData: FormData, name: string): string {
  const names = dateFieldNames(name);
  const read = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };

  return joinDateParts({
    year: read(names.year),
    month: read(names.month),
    day: read(names.day),
  });
}

export function getKoreaYear(): number {
  return Number(getKoreaDateIso().slice(0, 4));
}
