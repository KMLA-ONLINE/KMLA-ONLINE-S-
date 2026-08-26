export const BIRTHDAY_STALE_TIME = 60 * 60 * 1000;
export const BIRTHDAY_GC_TIME = 60 * 60 * 1000;

export const birthdayKeys = {
  all: ["birthdays"] as const,
  today: (referenceDate: string) =>
    [...birthdayKeys.all, "today", referenceDate] as const,
  month: (referenceDate: string) =>
    [...birthdayKeys.all, "month", referenceDate] as const,
};
