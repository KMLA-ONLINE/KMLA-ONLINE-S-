import { calendarWeekday } from "./korea-date";

export const GONGANG_FLOORS = [
  { id: "floor_b1", label: "지하 1층" },
  { id: "floor_2", label: "2층" },
  { id: "floor_4", label: "4층" },
  { id: "floor_10", label: "10층" },
] as const;
export const STUDY_SLOTS = [
  { id: "study-1", label: "1자습" },
  { id: "honjeong-end", label: "혼정끝" },
  { id: "study-2", label: "2자습" },
];
export const WEEKDAY_GONGANG_SLOTS = [
  { id: "lunch", label: "점심" },
  { id: "dinner", label: "저녁" },
  ...STUDY_SLOTS,
];
export const WEEKEND_GONGANG_SLOTS = [
  ...Array.from({ length: 11 }, (_, index) => {
    const start = index + 8;
    return {
      id: `hour-${start}`,
      label: `${String(start).padStart(2, "0")}:00–${String(start + 1).padStart(2, "0")}:00`,
    };
  }),
  ...STUDY_SLOTS,
];
export function isGongangWeekend(date: string) {
  return [0, 6].includes(calendarWeekday(date));
}
export function gongangSlots(date: string) {
  return isGongangWeekend(date) ? WEEKEND_GONGANG_SLOTS : WEEKDAY_GONGANG_SLOTS;
}
export function gongangKey(slot: string, location: string) {
  return `${slot}:${location}`;
}
export function parseGongangKey(key: string) {
  const [slot = "", location = ""] = key.split(":");
  return { slot, location };
}
/** Unknown ids fall back to the raw id so a stale key never renders "undefined". */
export function gongangCellLabel(date: string, slot: string, location: string) {
  const floor = GONGANG_FLOORS.find((item) => item.id === location);
  const time = gongangSlots(date).find((item) => item.id === slot);
  return `${floor?.label ?? location} ${time?.label ?? slot}`;
}
export function toggleGongangKey(values: string[], key: string) {
  return values.includes(key)
    ? values.filter((value) => value !== key)
    : [...values, key];
}
