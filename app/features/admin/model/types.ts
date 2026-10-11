import type { Database } from "~/shared/supabase/database.types";

type Functions = Database["public"]["Functions"];

export type AdminApplication =
  Functions["admin_list_applications"]["Returns"][number];
export type AcceptedUser =
  Functions["admin_list_accepted_users"]["Returns"][number];
export type AdminMember = Functions["admin_list_members"]["Returns"][number];

type RawStorageCleanupStatus =
  Functions["admin_storage_cleanup_status"]["Returns"][number];

/**
 * RPC가 마지막 실행을 `left join`으로 붙이므로 기록이 없으면 묶음 전체가 NULL이다(정리가 한 번도 안 돈 상태).
 * 생성 타입은 이를 non-null로 적어, 여기서 고쳐야 NULL 분기를 타입이 지킨다. 컬럼이 사라지면 아래 매핑이 컴파일 오류를 낸다.
 */
type NullableStorageCleanupField =
  | "queue_oldest_enqueued_at"
  | "last_run_started_at"
  | "last_run_finished_at"
  | "last_run_status_code"
  | "last_run_removed"
  | "last_run_failed"
  | "last_run_error"
  | "last_cron_status"
  | "last_cron_at";

export type StorageCleanupStatus = Omit<
  RawStorageCleanupStatus,
  NullableStorageCleanupField
> & {
  [Field in NullableStorageCleanupField]: RawStorageCleanupStatus[Field] | null;
};

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
