/**
 * 시간표의 localStorage adapter다. DB가 진짜 저장소이고 여기는 첫 페인트를 채우는
 * 캐시라, 파싱이 실패하면 던지지 않고 빈 시간표로 물러난다.
 */
import {
  DEFAULT_SEMESTER,
  emptyTimetable,
  readCourseArray,
  timetableFromStored,
  type TimetableStorage,
} from "~/features/timetable/model/timetable";

const STORAGE_KEY = "kmla-online:timetable:v3";
const LEGACY_STORAGE_KEY = "kmla-online:timetable:v2";

export function loadTimetable(): TimetableStorage {
  const empty = emptyTimetable();

  if (typeof window === "undefined") {
    return empty;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const parsed: unknown = JSON.parse(raw);

      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;

        return timetableFromStored(record.activeSemester, record.semesters);
      }
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);

    if (legacyRaw) {
      const legacy: unknown = JSON.parse(legacyRaw);
      const timetable = emptyTimetable();

      timetable.semesters[DEFAULT_SEMESTER] = readCourseArray(legacy);

      return timetable;
    }
  } catch {
    return empty;
  }

  return empty;
}

export function saveTimetable(timetable: TimetableStorage) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timetable));
  } catch {
    return;
  }
}
