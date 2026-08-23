import { useEffect, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { useAppShell } from "~/features/app-shell";
import {
  loadTimetableRecord,
  saveTimetableRecord,
  type StoredTimetableRecord,
} from "~/features/timetable/data/timetable";
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

type SemesterKey = "1-1" | "1-2" | "2-1" | "2-2" | "3-1" | "3-2";

interface TimetableStorage {
  activeSemester: SemesterKey;
  semesters: Record<SemesterKey, TimetableCourse[]>;
}

const STORAGE_KEY = "kmla-online:timetable:v3";
const LEGACY_STORAGE_KEY = "kmla-online:timetable:v2";

const SEMESTERS = [
  { id: "1-1", label: "1학년 1학기" },
  { id: "1-2", label: "1학년 2학기" },
  { id: "2-1", label: "2학년 1학기" },
  { id: "2-2", label: "2학년 2학기" },
  { id: "3-1", label: "3학년 1학기" },
  { id: "3-2", label: "3학년 2학기" },
] as const satisfies readonly {
  id: SemesterKey;
  label: string;
}[];

const DEFAULT_SEMESTER: SemesterKey = "1-1";

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

function isSemesterKey(value: unknown): value is SemesterKey {
  return SEMESTERS.some((semester) => semester.id === value);
}

function emptySemesters(): Record<SemesterKey, TimetableCourse[]> {
  return {
    "1-1": [],
    "1-2": [],
    "2-1": [],
    "2-2": [],
    "3-1": [],
    "3-2": [],
  };
}

function readCourseArray(value: unknown): TimetableCourse[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isCourse);
}

function loadTimetable(): TimetableStorage {
  const empty: TimetableStorage = {
    activeSemester: DEFAULT_SEMESTER,
    semesters: emptySemesters(),
  };

  if (typeof window === "undefined") {
    return empty;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const parsed: unknown = JSON.parse(raw);

      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const storedSemesters =
          record.semesters && typeof record.semesters === "object"
            ? (record.semesters as Record<string, unknown>)
            : {};

        const semesters = emptySemesters();

        for (const semester of SEMESTERS) {
          semesters[semester.id] = readCourseArray(
            storedSemesters[semester.id],
          );
        }

        return {
          activeSemester: isSemesterKey(record.activeSemester)
            ? record.activeSemester
            : DEFAULT_SEMESTER,
          semesters,
        };
      }
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);

    if (legacyRaw) {
      const legacy: unknown = JSON.parse(legacyRaw);
      const semesters = emptySemesters();

      semesters[DEFAULT_SEMESTER] = readCourseArray(legacy);

      return {
        activeSemester: DEFAULT_SEMESTER,
        semesters,
      };
    }
  } catch {
    return empty;
  }

  return empty;
}

function saveTimetable(timetable: TimetableStorage) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timetable));
  } catch {
    return;
  }
}

function timetableFromDb(record: StoredTimetableRecord): TimetableStorage {
  const semesters = emptySemesters();

  const stored =
    record.semesters && typeof record.semesters === "object"
      ? (record.semesters as Record<string, unknown>)
      : {};

  for (const semester of SEMESTERS) {
    semesters[semester.id] = readCourseArray(stored[semester.id]);
  }

  return {
    activeSemester: isSemesterKey(record.activeSemester)
      ? record.activeSemester
      : DEFAULT_SEMESTER,
    semesters,
  };
}

export function TimetableScreen() {
  const { profile } = useAppShell();

  const [timetable, setTimetable] = useState<TimetableStorage>(loadTimetable);

  const activeSemester = timetable.activeSemester;
  const courses = timetable.semesters[activeSemester];

  const [draft, setDraft] = useState<CourseDraft | null>(null);

  const [overlap, setOverlap] = useState(false);

  const today = getKoreaWeekday();

  useEffect(() => {
    let cancelled = false;

    const syncFromDb = async () => {
      try {
        const stored = await loadTimetableRecord(profile.id);

        if (cancelled) {
          return;
        }

        if (stored) {
          const next = timetableFromDb(stored);

          setTimetable(next);
          saveTimetable(next);
          return;
        }

        const local = loadTimetable();

        await saveTimetableRecord(
          profile.id,
          local.activeSemester,
          local.semesters,
        );
      } catch (error) {
        console.error("Failed to sync timetable", error);
      }
    };

    const refresh = () => {
      void syncFromDb();
    };

    void syncFromDb();

    window.addEventListener("focus", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [profile.id]);

  const persistTimetable = (next: TimetableStorage) => {
    setTimetable(next);
    saveTimetable(next);

    void saveTimetableRecord(
      profile.id,
      next.activeSemester,
      next.semesters,
    ).catch((error: unknown) => {
      console.error("Failed to save timetable", error);
    });
  };

  const updateCourses = (next: TimetableCourse[]) => {
    const nextTimetable: TimetableStorage = {
      ...timetable,
      semesters: {
        ...timetable.semesters,
        [activeSemester]: next,
      },
    };

    persistTimetable(nextTimetable);
  };

  const selectSemester = (semester: SemesterKey) => {
    const nextTimetable: TimetableStorage = {
      ...timetable,
      activeSemester: semester,
    };

    persistTimetable(nextTimetable);
    setDraft(null);
    setOverlap(false);
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
      <div className="flex h-[calc(100dvh-var(--app-page-header-h)-var(--app-safe-t))] min-h-0 w-full flex-col overflow-hidden pb-[calc(1rem+var(--app-safe-b))] md:h-[calc(100dvh-var(--app-header-h)-3rem)] md:pb-0">
        <div className="shrink-0 border-y bg-background px-3 py-2.5">
          <NativeSelect
            aria-label="학기"
            value={activeSemester}
            className="w-full [&>select]:h-10 [&>select]:rounded-xl [&>select]:bg-muted/20 [&>select]:font-medium"
            onChange={(event) => {
              const semester = event.target.value;

              if (isSemesterKey(semester)) {
                selectSemester(semester);
              }
            }}
          >
            {SEMESTERS.map((semester) => (
              <NativeSelectOption key={semester.id} value={semester.id}>
                {semester.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

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
                  onClick={() => openNew(dayPosition as Weekday, period.period)}
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
                  onClick={() => openExisting(course)}
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
                    <span className="mt-1 block truncate text-[9px] font-medium text-white/80">
                      {meeting.room}
                    </span>
                  ) : null}
                </button>
              )),
            )}
          </div>
        </div>
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
