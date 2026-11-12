import { calendarDate, fullDateLabel } from "../model/korea-date";
import { cn } from "~/shared/lib/utils";

const rangeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  month: "numeric",
  day: "numeric",
});

const weekdayFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  weekday: "short",
});

/** 공강과 노래방이 같이 쓰는 주간 날짜 선택줄. 지난 날짜도 지난 예약을 보려고 고를 수 있다. */
export function UtilityWeekStrip({
  dates,
  selected,
  today,
  onSelect,
  disabled = false,
  className,
}: {
  dates: string[];
  selected: string;
  today: string;
  onSelect: (date: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="px-1 text-xs font-medium text-muted-foreground tabular-nums">
        {rangeFormat.format(calendarDate(dates[0]))} –{" "}
        {rangeFormat.format(calendarDate(dates[6]))}
      </p>

      <div className="mt-1 grid grid-cols-7">
        {dates.map((date) => {
          const isSelected = date === selected;

          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              aria-label={fullDateLabel(date)}
              aria-pressed={isSelected}
              onClick={() => onSelect(date)}
              className="flex touch-manipulation flex-col items-center gap-1 rounded-xl py-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span
                className={cn(
                  "text-xs transition-colors",
                  isSelected ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {weekdayFormat.format(calendarDate(date)).replace(".", "")}
              </span>

              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors",
                  isSelected && "bg-action text-action-foreground",
                  !isSelected && date === today && "text-primary",
                  // 지난 날도 열람하려고 누르므로 disabled의 opacity 대신 덜 강조만 한다.
                  !isSelected &&
                    date < today &&
                    "font-normal text-muted-foreground",
                )}
              >
                {calendarDate(date).getUTCDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
