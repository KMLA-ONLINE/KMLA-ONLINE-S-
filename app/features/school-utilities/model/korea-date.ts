import { useEffect, useState } from "react";

const koreaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function koreaTodayKey(now = new Date()) {
  const parts = koreaDateFormatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to resolve the Korea calendar date.");
  }

  return `${year}-${month}-${day}`;
}

export function calendarDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

export function addCalendarDays(date: string, amount: number) {
  const next = calendarDate(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

export function calendarWeekday(date: string) {
  return calendarDate(date).getUTCDay();
}

export function startOfKoreaWeek(date: string) {
  const day = calendarWeekday(date);
  return addCalendarDays(date, day === 0 ? -6 : 1 - day);
}

export function useKoreaToday() {
  const [today, setToday] = useState(koreaTodayKey);

  useEffect(() => {
    const refresh = () => setToday(koreaTodayKey());
    const nextMidnight = Date.parse(
      `${addCalendarDays(koreaTodayKey(), 1)}T00:00:01+09:00`,
    );
    const timer = window.setTimeout(
      refresh,
      Math.max(0, nextMidnight - Date.now()),
    );

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [today]);

  return today;
}
