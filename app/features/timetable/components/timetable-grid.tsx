import {
  COLORS,
  DAYS,
  PERIODS,
  getGridRow,
  type TimetableCourse,
  type Weekday,
} from "~/features/timetable/model/timetable";
import { cn } from "~/shared/lib/utils";

interface TimetableGridProps {
  courses: TimetableCourse[];
  today: Weekday | null;
  onAddCourse: (day: Weekday, period: number) => void;
  onSelectCourse: (course: TimetableCourse) => void;
}

export function TimetableGrid({
  courses,
  today,
  onAddCourse,
  onSelectCourse,
}: TimetableGridProps) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden border-b bg-background">
      <div className="grid h-full min-h-0 grid-cols-[2.25rem_repeat(5,minmax(0,1fr))] grid-rows-[2rem_repeat(4,minmax(0,1fr))_0.55rem_repeat(4,minmax(0,1fr))]">
        <div className="border-r border-b bg-muted/15" />

        {DAYS.map((day, dayPosition) => (
          <div
            key={day}
            style={{
              gridColumn: dayPosition + 2,
              gridRow: 1,
            }}
            className={cn(
              "flex items-center justify-center border-r border-b text-xs font-semibold",
              today === dayPosition
                ? "bg-primary/[0.06] text-primary"
                : "text-muted-foreground",
            )}
          >
            {day}
          </div>
        ))}

        <div
          style={{
            gridColumn: "1 / -1",
            gridRow: 6,
          }}
          className="border-y bg-muted/30"
        />

        {PERIODS.map((period) => (
          <div
            key={period.period}
            style={{
              gridColumn: 1,
              gridRow: getGridRow(period.period),
            }}
            className="flex flex-col items-center justify-center border-r border-b bg-muted/10"
          >
            <span className="text-xs font-semibold tabular-nums">
              {period.period}
            </span>

            <span className="mt-1 text-[9px] leading-none text-muted-foreground tabular-nums">
              {period.start}
            </span>
          </div>
        ))}

        {DAYS.flatMap((_, dayPosition) =>
          PERIODS.map((period) => (
            <button
              key={`${dayPosition}-${period.period}`}
              type="button"
              aria-label={`${DAYS[dayPosition]}요일 ${period.period}교시 수업 추가`}
              onClick={() => onAddCourse(dayPosition as Weekday, period.period)}
              style={{
                gridColumn: dayPosition + 2,
                gridRow: getGridRow(period.period),
              }}
              className={cn(
                "border-r border-b bg-background transition-colors hover:bg-muted/35 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted/70",
                today === dayPosition && "bg-primary/[0.012]",
              )}
            />
          )),
        )}

        {courses.flatMap((course) =>
          course.meetings.map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              aria-label={`${course.name} 수정`}
              onClick={() => onSelectCourse(course)}
              style={{
                gridColumn: meeting.day + 2,
                gridRow: `${getGridRow(meeting.start)} / ${
                  getGridRow(meeting.end) + 1
                }`,
              }}
              className={cn(
                "z-10 overflow-hidden border border-background/20 p-1.5 text-center transition-[filter] hover:brightness-[0.97] active:brightness-90",
                COLORS[course.color % COLORS.length],
              )}
            >
              <span className="block text-[11px] leading-[1.25] font-semibold tracking-[-0.02em] break-words">
                {course.name}
              </span>

              {meeting.room ? (
                <span className="mt-1 block truncate text-[9px] font-medium opacity-70">
                  {meeting.room}
                </span>
              ) : null}
            </button>
          )),
        )}
      </div>
    </div>
  );
}
