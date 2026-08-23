export type Weekday = 0 | 1 | 2 | 3 | 4;

export interface CourseMeeting {
  id: string;
  day: Weekday;
  start: number;
  end: number;
  room: string;
}

export interface TimetableCourse {
  id: string;
  name: string;
  color: number;
  meetings: CourseMeeting[];
}

export interface CourseDraft {
  id?: string;
  name: string;
  color: number;
  meetings: CourseMeeting[];
}

export type SemesterKey = "1-1" | "1-2" | "2-1" | "2-2" | "3-1" | "3-2";

export interface TimetableStorage {
  activeSemester: SemesterKey;
  semesters: Record<SemesterKey, TimetableCourse[]>;
}

export const SEMESTERS = [
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

export const DEFAULT_SEMESTER: SemesterKey = "1-1";

export const DAYS = ["월", "화", "수", "목", "금"] as const;

export const PERIODS = [
  { period: 1, start: "08:30" },
  { period: 2, start: "09:30" },
  { period: 3, start: "10:30" },
  { period: 4, start: "11:30" },
  { period: 5, start: "13:40" },
  { period: 6, start: "14:40" },
  { period: 7, start: "15:40" },
  { period: 8, start: "16:40" },
] as const;

export const COLORS = [
  "bg-blue-500 text-white",
  "bg-emerald-500 text-white",
  "bg-violet-500 text-white",
  "bg-orange-500 text-white",
  "bg-rose-500 text-white",
  "bg-cyan-500 text-white",
  "bg-amber-500 text-white",
  "bg-fuchsia-500 text-white",
] as const;

export const COLOR_DOTS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-orange-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-amber-500",
  "bg-fuchsia-500",
] as const;

export function createMeeting(day: Weekday = 0, start = 1): CourseMeeting {
  return {
    id: crypto.randomUUID(),
    day,
    start,
    end: start,
    room: "",
  };
}

/** 점심시간 줄(row 6) 때문에 5교시부터는 grid row가 한 칸 밀린다. */
export function getGridRow(period: number) {
  return period <= 4 ? period + 1 : period + 2;
}

export function getAvailableEndPeriods(start: number) {
  if (start <= 4) {
    return PERIODS.filter(
      (period) => period.period >= start && period.period <= 4,
    );
  }

  return PERIODS.filter((period) => period.period >= start);
}

export function getKoreaWeekday(): Weekday | null {
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

export function isSemesterKey(value: unknown): value is SemesterKey {
  return SEMESTERS.some((semester) => semester.id === value);
}

export function emptySemesters(): Record<SemesterKey, TimetableCourse[]> {
  return {
    "1-1": [],
    "1-2": [],
    "2-1": [],
    "2-2": [],
    "3-1": [],
    "3-2": [],
  };
}

export function readCourseArray(value: unknown): TimetableCourse[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isCourse);
}

export function emptyTimetable(): TimetableStorage {
  return {
    activeSemester: DEFAULT_SEMESTER,
    semesters: emptySemesters(),
  };
}

/** localStorage와 DB 어느 쪽에서 온 값이든 같은 규칙으로 훑어 담는다. */
export function timetableFromStored(
  activeSemester: unknown,
  storedSemesters: unknown,
): TimetableStorage {
  const stored =
    storedSemesters && typeof storedSemesters === "object"
      ? (storedSemesters as Record<string, unknown>)
      : {};

  const semesters = emptySemesters();

  for (const semester of SEMESTERS) {
    semesters[semester.id] = readCourseArray(stored[semester.id]);
  }

  return {
    activeSemester: isSemesterKey(activeSemester)
      ? activeSemester
      : DEFAULT_SEMESTER,
    semesters,
  };
}

/** draft의 시간끼리, 그리고 같은 학기의 다른 수업과 겹치는지 본다. */
export function hasScheduleConflict(
  draft: CourseDraft,
  courses: TimetableCourse[],
): boolean {
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
}
