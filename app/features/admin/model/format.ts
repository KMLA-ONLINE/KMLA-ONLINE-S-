import type { AdminApplication } from "~/features/admin/model/types";

export function formatProfileType(type: string): string {
  return type === "student" ? "학생" : type === "teacher" ? "교직원" : "졸업생";
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatApplicationField(
  value: AdminApplication[keyof AdminApplication],
): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (value === "domestic") return "국내반";
  if (value === "international") return "국제반";
  if (value === "male") return "남성";
  if (value === "female") return "여성";
  return String(value);
}
