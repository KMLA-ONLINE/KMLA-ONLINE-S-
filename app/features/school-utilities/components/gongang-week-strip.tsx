import { calendarDate } from "../model/korea-date";
import { cn } from "~/shared/lib/utils";
const dayFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  weekday: "short",
});
const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "long",
});
const rangeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  month: "numeric",
  day: "numeric",
});
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
                ? "bg-primary text-primary-foreground"
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
