import { Trash2Icon } from "lucide-react";

import {
  DAYS,
  PERIODS,
  getAvailableEndPeriods,
  type CourseMeeting,
  type Weekday,
} from "~/features/timetable/model/timetable";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

interface CourseMeetingFieldsProps {
  meeting: CourseMeeting;
  canRemove: boolean;
  onChange: (patch: Partial<CourseMeeting>) => void;
  onRemove: () => void;
}

/** 수업 편집 dialog 안의 시간 한 줄 — 요일, 시작·종료 교시, 교실. */
export function CourseMeetingFields({
  meeting,
  canRemove,
  onChange,
  onRemove,
}: CourseMeetingFieldsProps) {
  return (
    <div className="rounded-2xl bg-muted/45 p-2.5">
      <div className="flex items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-5 gap-1 rounded-xl bg-background/70 p-1">
          {DAYS.map((day, dayPosition) => (
            <button
              key={day}
              type="button"
              aria-pressed={meeting.day === dayPosition}
              onClick={() =>
                onChange({
                  day: dayPosition as Weekday,
                })
              }
              className={cn(
                "h-9 rounded-lg text-xs font-semibold",
                meeting.day === dayPosition
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {day}
            </button>
          ))}
        </div>

        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="시간 삭제"
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <NativeSelect
          aria-label="시작 교시"
          value={meeting.start}
          className="w-full"
          onChange={(event) => {
            const start = Number(event.target.value);

            const currentEndValid =
              start <= 4
                ? meeting.end >= start && meeting.end <= 4
                : meeting.end >= start;

            onChange({
              start,
              end: currentEndValid ? meeting.end : start,
            });
          }}
        >
          {PERIODS.map((period) => (
            <NativeSelectOption key={period.period} value={period.period}>
              {period.period}
              교시
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="종료 교시"
          value={meeting.end}
          className="w-full"
          onChange={(event) =>
            onChange({
              end: Number(event.target.value),
            })
          }
        >
          {getAvailableEndPeriods(meeting.start).map((period) => (
            <NativeSelectOption key={period.period} value={period.period}>
              {period.period}
              교시
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <Input
        value={meeting.room}
        aria-label="교실"
        placeholder="교실"
        className="mt-2 h-9 rounded-xl border-0 bg-background/70 shadow-none"
        onChange={(event) =>
          onChange({
            room: event.target.value,
          })
        }
      />
    </div>
  );
}
