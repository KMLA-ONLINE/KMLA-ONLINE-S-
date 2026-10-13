export interface HomeSidebarPreferences {
  enabled: boolean;
  birthdays: boolean;
  meal: boolean;
  timetable: boolean;
}

const STORAGE_KEY = "kmla-online:home-sidebar:v1";
const DEFAULTS: HomeSidebarPreferences = {
  enabled: true,
  birthdays: true,
  meal: true,
  timetable: true,
};

/** 저장값이 없거나 일부만 맞으면 나머지는 기본값(모두 표시)으로 채운다. */
export function readHomeSidebarPreferences(): HomeSidebarPreferences {
  const preferences = { ...DEFAULTS };
  if (typeof window === "undefined") return preferences;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return preferences;
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      const stored: unknown = (value as Record<string, unknown>)[key];
      if (typeof stored === "boolean") preferences[key] = stored;
    }
  } catch {
    // 읽지 못하면 기본값으로 그린다.
  }
  return preferences;
}

/** 저장하지 못해도 이번 화면의 선택은 유지한다. 다음 방문에는 기본값으로 돌아간다. */
export function writeHomeSidebarPreferences(value: HomeSidebarPreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 사생활 보호 모드나 용량 초과.
  }
}
