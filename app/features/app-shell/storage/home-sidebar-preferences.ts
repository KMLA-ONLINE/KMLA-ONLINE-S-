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

export function readHomeSidebarPreferences(): HomeSidebarPreferences {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return { ...DEFAULTS };
    return {
      enabled:
        "enabled" in value && typeof value.enabled === "boolean"
          ? value.enabled
          : true,
      birthdays:
        "birthdays" in value && typeof value.birthdays === "boolean"
          ? value.birthdays
          : true,
      meal:
        "meal" in value && typeof value.meal === "boolean" ? value.meal : true,
      timetable:
        "timetable" in value && typeof value.timetable === "boolean"
          ? value.timetable
          : true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeHomeSidebarPreferences(value: HomeSidebarPreferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}
