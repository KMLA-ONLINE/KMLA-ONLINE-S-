export type Weekday = 0 | 1 | 2 | 3 | 4;

export interface CourseMeeting {
  id: string;
  day: Weekday;
  start: number;
  end: number;
}

export interface TimetableCourse {
  id: string;
  name: string;
  color: number;
  room: string;
  meetings: CourseMeeting[];
}

export interface CourseDraft {
  id?: string;
  name: string;
  color: number;
  room: string;
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

const DEFAULT_SEMESTER: SemesterKey = "1-1";

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

/**
 * 빨주노초파남보 다음에 갈색과 회색. 인덱스가 그대로 저장되므로 순서를 바꾸면
 * 기존 수업 색도 바뀐다.
 *
 * 배경은 전부 `-400`으로 맞추고 글씨는 검은색으로 고정한다. 흰 글씨는 amber처럼 밝은
 * 계열에서 대비가 무너지지만, 검은 글씨는 이 명도대에서 어느 색이든 6:1 위로 나온다.
 * 칩 색은 테마를 따라가지 않으므로 `text-foreground`가 아니라 리터럴 `text-black`이다.
 *
 * 갈색은 Tailwind 팔레트에 없다. `stone`은 회색과 구분이 안 돼서 나머지 `-400`과 명도를
 * 맞춘 값을 직접 쓴다.
 */
export const COLORS = [
  "bg-rose-400 text-black",
  "bg-orange-400 text-black",
  "bg-amber-400 text-black",
  "bg-emerald-400 text-black",
  "bg-cyan-400 text-black",
  "bg-blue-400 text-black",
  "bg-violet-400 text-black",
  "bg-fuchsia-400 text-black",
  "bg-[#b5835a] text-black",
  "bg-gray-400 text-black",
] as const;

export const COLOR_DOTS = [
  "bg-rose-400",
  "bg-orange-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-cyan-400",
  "bg-blue-400",
  "bg-violet-400",
  "bg-fuchsia-400",
  "bg-[#b5835a]",
  "bg-gray-400",
] as const;

export function createMeeting(day: Weekday = 0, start = 1): CourseMeeting {
  return {
    id: crypto.randomUUID(),
    day,
    start,
    end: start,
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
    !(meeting.start <= 4 && meeting.end >= 5)
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
    typeof course.room === "string" &&
    Array.isArray(course.meetings) &&
    course.meetings.every(isMeeting)
  );
}

export function isSemesterKey(value: unknown): value is SemesterKey {
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
