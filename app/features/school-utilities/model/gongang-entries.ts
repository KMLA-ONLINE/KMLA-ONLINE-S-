import type { GongangScheduleEntry } from "../data/gongang-schedule";
import type { UtilityReservation } from "../data/reservations";

import { calendarWeekday } from "./korea-date";
import { gongangKey } from "./gongang-slots";

export function occursOn(
  row: {
    reservationDate: string;
    recurring: boolean;
    recurringUntil: string | null;
  },
  date: string,
) {
  return row.recurring
    ? date >= row.reservationDate &&
        (row.recurringUntil === null || date < row.recurringUntil) &&
        calendarWeekday(date) === calendarWeekday(row.reservationDate)
    : date === row.reservationDate;
}
export function scheduleOccursOn(row: GongangScheduleEntry, date: string) {
  return (
    row.reserved &&
    occursOn(
      {
        reservationDate: row.scheduleDate,
        recurring: row.recurring,
        recurringUntil: row.recurringUntil,
      },
      date,
    )
  );
}
export function gongangEntries(
  date: string,
  reservations: UtilityReservation[],
  schedules: GongangScheduleEntry[],
  profileId: number,
): GongangBoardEntry[] {
  const entries = new Map<string, GongangBoardEntry>();
  for (const row of reservations) {
    if (!row.location || !occursOn(row, date)) continue;
    entries.set(gongangKey(row.slot, row.location), {
      slot: row.slot,
      location: row.location,
      state: row.profileId === profileId ? "mine" : "reserved",
      label: row.profileId === profileId ? "내 예약" : row.applicantName,
      detail: row.detail,
      recurring: row.recurring,
    });
  }
  for (const row of schedules) {
    if (!scheduleOccursOn(row, date)) continue;
    entries.set(gongangKey(row.slot, row.location), {
      slot: row.slot,
      location: row.location,
      state: "manager",
      label: "선예약",
      detail: row.detail ?? "",
      recurring: row.recurring,
    });
  }
  return [...entries.values()];
}

export interface GongangBoardEntry {
  slot: string;
  location: string;
  state: "reserved" | "mine" | "manager";
  label: string;
  detail: string;
  recurring: boolean;
}
