import * as React from "react";

import {
  dateFieldNames,
  daysInMonth,
  getKoreaYear,
  splitDateValue,
} from "~/shared/lib/date-field";
import { cn } from "~/shared/lib/utils";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

const MIN_YEAR = 1950;
/** 재학생 대부분의 출생 연도. 목록을 여기서 시작해 맨 위가 곧 정답이 되게 한다. */
const YEAR_OFFSET = 15;

const PAD = (value: number) => String(value).padStart(2, "0");
const MONTHS = Array.from({ length: 12 }, (_, index) => PAD(index + 1));

function yearOptions(min: number, max: number): number[] {
  const years: number[] = [];
  for (let year = max; year >= min; year -= 1) years.push(year);

  return years;
}

/**
 * 생년월일처럼 먼 과거를 고르는 날짜 입력. 달력 팝오버는 몇 년치를 넘겨야 하고
 * `<input type="date">`는 데스크톱에서 폭이 제멋대로라, 년/월/일 세 칸으로 나눈다.
 *
 * 폼에는 `${name}Year`/`${name}Month`/`${name}Day`로 실려 나가고, 받는 쪽은
 * `readDateField()`로 `YYYY-MM-DD` 한 줄을 되돌려 받는다.
 */
function DateSelect({
  id,
  name,
  defaultValue = "",
  minYear = MIN_YEAR,
  maxYear = getKoreaYear() - YEAR_OFFSET,
  disabled,
  required,
  className,
  "aria-invalid": invalid,
}: {
  id?: string;
  name: string;
  defaultValue?: string;
  minYear?: number;
  maxYear?: number;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
}) {
  const saved = splitDateValue(defaultValue);
  const [parts, setParts] = React.useState(saved);
  const names = dateFieldNames(name);
  const lastDay = daysInMonth(parts.year, parts.month);
  // 이미 저장된 값이 있으면 그 연도가 목록의 시작이다. `maxYear`는 아직 아무것도
  // 모를 때 쓰는 추측일 뿐이라, 저장된 값을 잘라내거나 혼자 떠 있게 두면 안 된다.
  const lastYear = Math.max(maxYear, Number(saved.year) || 0);

  function update(key: keyof typeof parts, value: string) {
    setParts((previous) => {
      const next = { ...previous, [key]: value };
      // 31일을 고른 뒤 2월로 옮기는 경우. 없는 날짜가 남아 있지 않게 끝으로 당긴다.
      const limit = daysInMonth(next.year, next.month);
      if (Number(next.day) > limit) next.day = PAD(limit);
      return next;
    });
  }

  const shared = { disabled, required, "aria-invalid": invalid };

  return (
    <div className={cn("flex gap-2", className)}>
      <NativeSelect
        {...shared}
        id={id}
        name={names.year}
        className="flex-1"
        value={parts.year}
        onChange={(event) => update("year", event.target.value)}
      >
        <NativeSelectOption value="">연도</NativeSelectOption>
        {yearOptions(minYear, lastYear).map((year) => (
          <NativeSelectOption key={year} value={String(year)}>
            {year}년
          </NativeSelectOption>
        ))}
      </NativeSelect>

      <NativeSelect
        {...shared}
        name={names.month}
        className="flex-1"
        aria-label="월"
        value={parts.month}
        onChange={(event) => update("month", event.target.value)}
      >
        <NativeSelectOption value="">월</NativeSelectOption>
        {MONTHS.map((month) => (
          <NativeSelectOption key={month} value={month}>
            {Number(month)}월
          </NativeSelectOption>
        ))}
      </NativeSelect>

      <NativeSelect
        {...shared}
        name={names.day}
        className="flex-1"
        aria-label="일"
        value={parts.day}
        onChange={(event) => update("day", event.target.value)}
      >
        <NativeSelectOption value="">일</NativeSelectOption>
        {Array.from({ length: lastDay }, (_, index) => PAD(index + 1)).map(
          (day) => (
            <NativeSelectOption key={day} value={day}>
              {Number(day)}일
            </NativeSelectOption>
          ),
        )}
      </NativeSelect>
    </div>
  );
}

export { DateSelect };
