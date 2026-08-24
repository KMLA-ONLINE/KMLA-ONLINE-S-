import type { Database } from "~/shared/supabase/database.types";

type Functions = Database["public"]["Functions"];

export type AdminApplication =
  Functions["admin_list_applications"]["Returns"][number];
export type AcceptedUser =
  Functions["admin_list_accepted_users"]["Returns"][number];
export type AdminMember = Functions["admin_list_members"]["Returns"][number];

export interface AdminActionResult {
  ok?: boolean;
  error?: string;
}

export function normalizeAdminSearch(value: string | null): string {
  const query = value?.trim() ?? "";
  return query.length >= 2 ? query : "";
}

export function isRecentAdminAuthError(error: unknown): boolean {
  return errorMessage(error).includes(
    "recent password authentication required",
  );
}

export function isAdminAccessError(error: unknown): boolean {
  return errorCode(error) === "42501" && !isRecentAdminAuthError(error);
}

export function getAdminErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("final app administrator")) {
    return "마지막 앱 관리자는 강등할 수 없습니다.";
  }
  if (message.includes("recent password authentication required")) {
    return "보안을 위해 현재 비밀번호를 다시 확인해 주세요.";
  }
  if (message.includes("Invalid login credentials")) {
    return "비밀번호가 올바르지 않습니다.";
  }
  if (errorCode(error) === "42501") return "관리자 권한이 필요합니다.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "";
}
