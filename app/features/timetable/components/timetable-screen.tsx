import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

type Weekday = 0 | 1 | 2 | 3 | 4;

interface CourseMeeting {
  id: string;
  day: Weekday;
  start: number;
  end: number;
  room: string;
}

interface TimetableCourse {
  id: string;
  name: string;
  color: number;
  meetings: CourseMeeting[];
}

interface CourseDraft {
  id?: string;
  name: string;
  color: number;
  meetings: CourseMeeting[];
}

const STORAGE_KEY = "kmla-online:timetable:v2";

const DAYS = ["월", "화", "수", "목", "금"] as const;

const PERIODS = [
  { period: 1, start: "08:30" },
  { period: 2, start: "09:30" },
  { period: 3, start: "10:30" },
  { period: 4, start: "11:30" },
  { period: 5, start: "13:40" },
  { period: 6, start: "14:40" },
  { period: 7, start: "15:40" },
  { period: 8, start: "16:40" },
] as const;

const COLORS = [
  "bg-blue-500 text-white",
  "bg-emerald-500 text-white",
  "bg-violet-500 text-white",
  "bg-orange-500 text-white",
  "bg-rose-500 text-white",
  "bg-cyan-500 text-white",
  "bg-amber-500 text-white",
  "bg-fuchsia-500 text-white",
] as const;

const COLOR_DOTS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-orange-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-amber-500",
  "bg-fuchsia-500",
] as const;

function createMeeting(day: Weekday = 0, start = 1): CourseMeeting {
  return {
    id: crypto.randomUUID(),
    day,
    start,
    end: start,
    room: "",
  };
}

function getGridRow(period: number) {
  return period <= 4 ? period + 1 : period + 2;
}

function getAvailableEndPeriods(start: number) {
  if (start <= 4) {
    return PERIODS.filter(
      (period) => period.period >= start && period.period <= 4,
    );
  }

  return PERIODS.filter((period) => period.period >= start);
}

function getKoreaWeekday(): Weekday | null {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(new Date());

  const values: Record<string, Weekday> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
  };

  return values[weekday] ?? null;
}

function isMeeting(value: unknown): value is CourseMeeting {
  if (!value || typeof value !== "object") {
    return false;
  }

  const meeting = value as Record<string, unknown>;

  return (
    typeof meeting.id === "string" &&
    typeof meeting.day === "number" &&
    Number.isInteger(meeting.day) &&
    meeting.day >= 0 &&
    meeting.day <= 4 &&
    typeof meeting.start === "number" &&
    Number.isInteger(meeting.start) &&
    meeting.start >= 1 &&
    meeting.start <= 8 &&
    typeof meeting.end === "number" &&
    Number.isInteger(meeting.end) &&
    meeting.end >= meeting.start &&
    meeting.end <= 8 &&
    !(meeting.start <= 4 && meeting.end >= 5) &&
    typeof meeting.room === "string"
  );
}

function isCourse(value: unknown): value is TimetableCourse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const course = value as Record<string, unknown>;

  return (
    typeof course.id === "string" &&
    typeof course.name === "string" &&
    typeof course.color === "number" &&
    Array.isArray(course.meetings) &&
    course.meetings.every(isMeeting)
  );
}

function loadCourses(): TimetableCourse[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isCourse);
  } catch {
    return [];
  }
}

function saveCourses(courses: TimetableCourse[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
  } catch {
    return;
  }
}

export function TimetableScreen() {
  const [courses, setCourses] = useState<TimetableCourse[]>(loadCourses);

  const [draft, setDraft] = useState<CourseDraft | null>(null);

  const [overlap, setOverlap] = useState(false);

  const today = getKoreaWeekday();

  const updateCourses = (next: TimetableCourse[]) => {
    setCourses(next);
    saveCourses(next);
  };

  const openNew = (day: Weekday, period: number) => {
    setOverlap(false);

    setDraft({
      name: "",
      color: courses.length % COLORS.length,
      meetings: [createMeeting(day, period)],
    });
  };

  const openExisting = (course: TimetableCourse) => {
    setOverlap(false);

    setDraft({
      id: course.id,
      name: course.name,
      color: course.color,
      meetings: course.meetings.map((meeting) => ({
        ...meeting,
      })),
    });
  };

  const updateMeeting = (id: string, patch: Partial<CourseMeeting>) => {
    if (!draft) {
      return;
    }

    setOverlap(false);

    setDraft({
      ...draft,
      meetings: draft.meetings.map((meeting) =>
        meeting.id === id
          ? {
              ...meeting,
              ...patch,
            }
          : meeting,
      ),
    });
  };

  const addMeeting = () => {
    if (!draft) {
      return;
    }

    const last = draft.meetings.at(-1);

    const nextDay = last ? (((last.day + 1) % 5) as Weekday) : 0;

    setOverlap(false);

    setDraft({
      ...draft,
      meetings: [...draft.meetings, createMeeting(nextDay, 1)],
    });
  };

  const removeMeeting = (id: string) => {
    const current = draft;

    if (!current) {
      return;
    }

    if (current.meetings.length <= 1) {
      return;
    }

    setOverlap(false);

    setDraft({
      ...current,
      meetings: current.meetings.filter((meeting) => meeting.id !== id),
    });
  };

  const hasConflict = () => {
    if (!draft) {
      return false;
    }

    const meetings = draft.meetings;

    const internalConflict = meetings.some((meeting, position) =>
      meetings
        .slice(position + 1)
        .some(
          (other) =>
            other.day === meeting.day &&
            other.start <= meeting.end &&
            other.end >= meeting.start,
        ),
    );

    if (internalConflict) {
      return true;
    }

    return courses
      .filter((course) => course.id !== draft.id)
      .some((course) =>
        course.meetings.some((existing) =>
          meetings.some(
            (meeting) =>
              existing.day === meeting.day &&
              existing.start <= meeting.end &&
              existing.end >= meeting.start,
          ),
        ),
      );
  };

  const save = () => {
    if (!draft?.name.trim()) {
      return;
    }

    if (hasConflict()) {
      setOverlap(true);
      return;
    }

    const course: TimetableCourse = {
      id: draft.id ?? crypto.randomUUID(),
      name: draft.name.trim(),
      color: draft.color,
      meetings: draft.meetings,
    };

    const next = draft.id
      ? courses.map((item) => (item.id === draft.id ? course : item))
      : [...courses, course];

    updateCourses(next);
    setDraft(null);
  };

  const removeCourse = () => {
    if (!draft?.id) {
      return;
    }

    updateCourses(courses.filter((course) => course.id !== draft.id));

    setDraft(null);
  };

  return (
    <>
      <div className="w-full pb-24">
        <div className="w-full overflow-hidden border-y bg-background">
          <div className="grid min-h-[calc(100dvh-8rem)] grid-cols-[2.25rem_repeat(5,minmax(0,1fr))] grid-rows-[2.4rem_repeat(4,minmax(4.45rem,1fr))_0.7rem_repeat(4,minmax(4.45rem,1fr))]">
            <div className="border-r border-b bg-muted/15" />

            {DAYS.map((day, dayPosition) => (
              <div
                key={day}
                style={{
                  gridColumn: dayPosition + 2,
                  gridRow: 1,
                }}
                className={cn(
                  "flex items-center justify-center border-r border-b text-[11px] font-semibold",
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
                <span className="text-[11px] font-semibold tabular-nums">
                  {period.period}
                </span>

                <span className="mt-1 text-[8px] leading-none text-muted-foreground tabular-nums">
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
                  onClick={() => openNew(dayPosition as Weekday, period.period)}
                  style={{
                    gridColumn: dayPosition + 2,
                    gridRow: getGridRow(period.period),
                  }}
                  className={cn(
                    "border-r border-b bg-background transition-colors active:bg-muted/70",
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
                  onClick={() => openExisting(course)}
                  style={{
                    gridColumn: meeting.day + 2,
                    gridRow: `${getGridRow(meeting.start)} / ${
                      getGridRow(meeting.end) + 1
                    }`,
                  }}
                  className={cn(
                    "z-10 overflow-hidden border border-background/20 p-1.5 text-center transition-[filter] active:brightness-90",
                    COLORS[course.color % COLORS.length],
                  )}
                >
                  <span className="block text-[10px] leading-[1.25] font-semibold tracking-[-0.02em] break-words">
                    {course.name}
                  </span>

                  {meeting.room ? (
                    <span className="mt-1 block truncate text-[8px] font-medium text-white/75">
                      {meeting.room}
                    </span>
                  ) : null}
                </button>
              )),
            )}
          </div>
        </div>

        <Button
          type="button"
          size="icon-lg"
          aria-label="수업 추가"
          onClick={() => openNew(today ?? 0, 1)}
          className="fixed right-4 bottom-20 z-30 size-12 rounded-full shadow-lg"
        >
          <PlusIcon className="size-5" />
        </Button>
      </div>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
          }
        }}
      >
        <DialogContent className="max-h-[88dvh] gap-4 overflow-y-auto rounded-2xl p-4">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "수업 수정" : "수업 추가"}</DialogTitle>
          </DialogHeader>

          {draft ? (
            <>
              <Input
                value={draft.name}
                aria-label="과목명"
                placeholder="과목명"
                className="h-11 rounded-xl px-3 text-base font-medium"
                onChange={(event) => {
                  setOverlap(false);

                  setDraft({
                    ...draft,
                    name: event.target.value,
                  });
                }}
              />

              <div className="flex justify-between px-1">
                {COLOR_DOTS.map((color, colorPosition) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`색상 ${colorPosition + 1}`}
                    aria-pressed={draft.color === colorPosition}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        color: colorPosition,
                      })
                    }
                    className={cn(
                      "size-6 rounded-full transition-transform active:scale-90",
                      color,
                      draft.color === colorPosition &&
                        "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
                    )}
                  />
                ))}
              </div>

              <div className="space-y-2">
                {draft.meetings.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="rounded-2xl bg-muted/45 p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="grid min-w-0 flex-1 grid-cols-5 gap-1 rounded-xl bg-background/70 p-1">
                        {DAYS.map((day, dayPosition) => (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={meeting.day === dayPosition}
                            onClick={() =>
                              updateMeeting(meeting.id, {
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

                      {draft.meetings.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="시간 삭제"
                          onClick={() => removeMeeting(meeting.id)}
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

                          updateMeeting(meeting.id, {
                            start,
                            end: currentEndValid ? meeting.end : start,
                          });
                        }}
                      >
                        {PERIODS.map((period) => (
                          <NativeSelectOption
                            key={period.period}
                            value={period.period}
                          >
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
                          updateMeeting(meeting.id, {
                            end: Number(event.target.value),
                          })
                        }
                      >
                        {getAvailableEndPeriods(meeting.start).map((period) => (
                          <NativeSelectOption
                            key={period.period}
                            value={period.period}
                          >
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
                        updateMeeting(meeting.id, {
                          room: event.target.value,
                        })
                      }
                    />
                  </div>
                ))}

                <button
                  type="button"
                  aria-label="시간 추가"
                  onClick={addMeeting}
                  className="flex h-11 w-full items-center justify-center rounded-2xl border border-dashed text-muted-foreground transition-colors active:bg-muted"
                >
                  <PlusIcon className="size-4" />
                </button>
              </div>

              {overlap ? (
                <p className="px-1 text-xs text-destructive">
                  겹치는 수업이 있어
                </p>
              ) : null}

              <DialogFooter className="flex-row items-center">
                {draft.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="수업 삭제"
                    onClick={removeCourse}
                    className="text-destructive"
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}

                <Button
                  type="button"
                  className="ml-auto min-w-20 rounded-xl"
                  disabled={!draft.name.trim()}
                  onClick={save}
                >
                  저장
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
