export const ABSENCE_STALE_TIME = 60_000;

export const absenceKeys = {
  all: ["absences"] as const,
  today: (referenceDate: string) =>
    [...absenceKeys.all, "today", referenceDate] as const,
};
