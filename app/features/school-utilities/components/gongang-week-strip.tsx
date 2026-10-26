import { useMemo } from "react";

import { calendarDate } from "../model/korea-date";
import { useLocale, type Locale } from "~/shared/i18n";
import { cn } from "~/shared/lib/utils";

/** 달력 날짜(UTC 자정)를 그 날짜 그대로 읽는다. 화면 언어만 바뀌고 시간대는 바뀌지 않는다. */
function weekStripFormats(locale: Locale = "ko") {
  const tag = locale === "en" ? "en-US" : "ko-KR";
  return {
    day: new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "short" }),
    date: new Intl.DateTimeFormat(tag, {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
      weekday: "long",
    }),
    range: new Intl.DateTimeFormat(tag, {
      timeZone: "UTC",
      month: "numeric",
      day: "numeric",
    }),
  };
}
export function GongangWeekStrip({
  dates,
  selected,
  onSelect,
  disabled = false,
}: {
  dates: string[];
  selected: string;
  onSelect: (date: string) => void;
  disabled?: boolean;
}) {
  const locale = useLocale();
  const {
    day: dayFormat,
    date: dateFormat,
    range: rangeFormat,
  } = useMemo(() => weekStripFormats(locale), [locale]);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground tabular-nums">
        {rangeFormat.format(calendarDate(dates[0]))} –{" "}
        {rangeFormat.format(calendarDate(dates[6]))}
      </p>
      <div className="grid grid-cols-7 gap-1">
        {dates.map((date) => (
          <button
            key={date}
            type="button"
            disabled={disabled}
            aria-label={dateFormat.format(calendarDate(date))}
            aria-pressed={date === selected}
            onClick={() => onSelect(date)}
            className={cn(
              "flex min-h-14 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              date === selected
                ? "bg-action text-action-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <span className="text-xs">
              {dayFormat.format(calendarDate(date))}
            </span>
            <span className="font-semibold tabular-nums">
              {calendarDate(date).getUTCDate()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
