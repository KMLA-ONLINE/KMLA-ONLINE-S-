import type { HeraldPoll } from "./types";

export function isPollClosed(poll: HeraldPoll, now: number) {
  return poll.closed || (!!poll.closesAt && Date.parse(poll.closesAt) <= now);
}

export function formatPollDeadline(value: string) {
  return (
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: true,
      timeZone: "Asia/Seoul",
    }).format(new Date(value)) + " KST"
  );
}

export interface PollDeadlineFields {
  date: string;
  hour: string;
  minute: string;
  period: string;
}

export function pollDeadlineFields(value?: string): PollDeadlineFields {
  if (!value) return { date: "", hour: "12", minute: "00", period: "PM" };
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Seoul",
  }).formatToParts(new Date(value));
  const part = (key: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === key)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: part("hour"),
    minute: part("minute"),
    period: part("dayPeriod"),
  };
}

export function parsePollDeadline(fields: PollDeadlineFields) {
  const hour = Number(fields.hour);
  const minute = Number(fields.minute);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fields.date) ||
    !/^\d{1,2}$/.test(fields.hour) ||
    !/^\d{1,2}$/.test(fields.minute) ||
    !Number.isInteger(hour) ||
    hour < 1 ||
    hour > 12 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !["AM", "PM"].includes(fields.period)
  )
    throw new Error("Choose a valid closing date and time in KST.");
  const hour24 = (hour % 12) + (fields.period === "PM" ? 12 : 0);
  const date = new Date(
    `${fields.date}T${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`,
  );
  if (
    !Number.isFinite(date.getTime()) ||
    pollDeadlineFields(date.toISOString()).date !== fields.date
  )
    throw new Error("Choose a valid closing date and time in KST.");
  return date.toISOString();
}
