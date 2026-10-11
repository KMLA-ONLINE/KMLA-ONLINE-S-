/**
 * 시간표의 localStorage adapter다. DB가 진짜 저장소이고 여기는 첫 페인트를 채우는
 * 캐시라, 파싱이 실패하면 던지지 않고 빈 시간표로 물러난다.
 */
import {
  emptyTimetable,
  timetableFromStored,
  type TimetableStorage,
} from "~/features/timetable/model/timetable";
// 계정이 바뀌면 버려야 하는 값이라 키 자체는 `user-scoped-storage`가 소유한다.
import { TIMETABLE_STORAGE_KEY } from "~/shared/lib/user-scoped-storage";

export function loadTimetable(): TimetableStorage {
  const empty = emptyTimetable();

  if (typeof window === "undefined") {
    return empty;
  }

  try {
    const raw = window.localStorage.getItem(TIMETABLE_STORAGE_KEY);

    if (raw) {
      const parsed: unknown = JSON.parse(raw);

      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;

        return timetableFromStored(record.activeSemester, record.semesters);
      }
    }
  } catch {
    return empty;
  }

  return empty;
}

export function saveTimetable(timetable: TimetableStorage) {
  try {
    window.localStorage.setItem(
      TIMETABLE_STORAGE_KEY,
      JSON.stringify(timetable),
    );
  } catch {
    return;
  }
}
