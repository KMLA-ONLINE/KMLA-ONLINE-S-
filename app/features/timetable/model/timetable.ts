import { randomUUID } from "~/shared/lib/random-uuid";
import type { Locale } from "~/shared/i18n";

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

const WEEKDAY_LABELS: Record<
  Locale,
  { short: readonly string[]; long: readonly string[] }
> = {
  ko: {
    short: DAYS,
    long: ["월요일", "화요일", "수요일", "목요일", "금요일"],
  },
  en: {
    short: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    long: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  },
};

/** 요일 이름. `DAYS`는 저장 인덱스이자 한국어 짧은 이름이라 그대로 두고, 화면은 이걸 쓴다. */
export function weekdayLabel(
  day: Weekday,
  locale: Locale = "ko",
  length: "short" | "long" = "short",
) {
  return WEEKDAY_LABELS[locale][length][day];
}

export function periodLabel(period: number, locale: Locale = "ko") {
  return locale === "en" ? `Period ${period}` : `${period}교시`;
}

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
 * 인덱스가 그대로 저장되므로 순서를 바꾸면 기존 수업 색도 바뀐다.
 * 기존 0~9번 색은 `-400`과 검은 글씨를 유지한다. 추가 색은 밝기에 맞춰 글씨 대비를 정한다.
 * 갈색은 Tailwind 팔레트에 없고 `stone`은 회색과 구분이 안 돼 명도를 맞춘 값을 직접 쓴다.
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
  "bg-rose-200 text-black",
  "bg-rose-300 text-black",
  "bg-rose-500 text-black",
  "bg-rose-600 text-white",
  "bg-orange-200 text-black",
  "bg-orange-300 text-black",
  "bg-orange-500 text-black",
  "bg-orange-600 text-black",
  "bg-amber-200 text-black",
  "bg-amber-300 text-black",
  "bg-amber-500 text-black",
  "bg-amber-600 text-black",
  "bg-emerald-200 text-black",
  "bg-emerald-300 text-black",
  "bg-emerald-500 text-black",
  "bg-emerald-600 text-black",
  "bg-cyan-200 text-black",
  "bg-cyan-300 text-black",
  "bg-cyan-500 text-black",
  "bg-cyan-600 text-black",
  "bg-blue-200 text-black",
  "bg-blue-300 text-black",
  "bg-blue-500 text-black",
  "bg-blue-600 text-white",
  "bg-violet-200 text-black",
  "bg-violet-300 text-black",
  "bg-violet-500 text-white",
  "bg-violet-600 text-white",
  "bg-fuchsia-200 text-black",
  "bg-fuchsia-300 text-black",
  "bg-fuchsia-500 text-black",
  "bg-fuchsia-600 text-white",
  "bg-[#e8cbb5] text-black",
  "bg-[#d3a683] text-black",
  "bg-[#966a48] text-white",
  "bg-[#745137] text-white",
  "bg-gray-200 text-black",
  "bg-gray-300 text-black",
  "bg-gray-500 text-white",
  "bg-gray-600 text-white",
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

// 기존 0~9번 색상은 저장된 시간표와 연결되어 있으므로 새 색상은 뒤에만 추가한다.
export const COLOR_SHADES = COLOR_DOTS.map((_, preset) => [
  10 + preset * 4,
  11 + preset * 4,
  preset,
  12 + preset * 4,
  13 + preset * 4,
]);

export function createMeeting(day: Weekday = 0, start = 1): CourseMeeting {
  return {
    id: randomUUID(),
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
