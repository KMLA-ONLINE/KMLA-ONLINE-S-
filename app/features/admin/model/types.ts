import type { Database } from "~/shared/supabase/database.types";

type Functions = Database["public"]["Functions"];

export type AdminApplication =
  Functions["admin_list_applications"]["Returns"][number];
export type AcceptedUser =
  Functions["admin_list_accepted_users"]["Returns"][number];
export type AdminMember = Functions["admin_list_members"]["Returns"][number];
type RawRosterMember = Functions["admin_list_roster"]["Returns"][number];

/**
 * 교직원은 기수가, 학생 외에는 부서가 비어 있다. 정지 중이 아니거나 무기한 정지면 해제 예정 시각이 비어 있다.
 * 생성 타입은 `returns table` 컬럼을 non-null로 적어 여기서 고친다.
 */
export type RosterMember = Omit<
  RawRosterMember,
  "cohort" | "department" | "suspension_expires_at"
> & {
  cohort: RawRosterMember["cohort"] | null;
  department: RawRosterMember["department"] | null;
  suspension_expires_at: RawRosterMember["suspension_expires_at"] | null;
};

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

type RawSchoolNoticeStatus =
  Functions["admin_school_notice_status"]["Returns"][number];

/** 계정을 넣기 전이나 동기화가 한 번도 돌지 않았으면 비어 있다. 생성 타입은 이를 non-null로 적는다. */
type NullableSchoolNoticeField =
  | "login_id"
  | "account_updated_at"
  | "last_requested_at"
  | "last_attempt_at"
  | "last_success_at"
  | "last_error"
  | "last_error_at";

export type SchoolNoticeStatus = Omit<
  RawSchoolNoticeStatus,
  NullableSchoolNoticeField
> & {
  [Field in NullableSchoolNoticeField]: RawSchoolNoticeStatus[Field] | null;
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
  if (message.includes("app administrators cannot be suspended")) {
    return "앱 관리자는 정지할 수 없습니다. 먼저 관리자에서 내려 주세요.";
  }
  if (message.includes("profile is already suspended")) {
    return "이미 정지 중인 사용자입니다.";
  }
  if (message.includes("profile is not suspended")) {
    return "정지 중인 사용자가 아닙니다.";
  }
  if (message.includes("reason must be 5 to 300 characters")) {
    return "사유를 5~300자로 입력해 주세요.";
  }
  if (message.includes("days must be between 1 and 180")) {
    return "기간은 1~180일로 입력해 주세요.";
  }
  if (message.includes("recent password authentication required")) {
    return "보안을 위해 현재 비밀번호를 다시 확인해 주세요.";
  }
  if (message.includes("Invalid login credentials")) {
    return "비밀번호가 올바르지 않습니다.";
  }
  if (message.includes("school notice sync vault configuration is missing")) {
    return "동기화 설정(Vault)이 없어 실행하지 못했습니다.";
  }
  if (message.includes("school id must be")) {
    return "학교 아이디를 입력해 주세요.";
  }
  if (message.includes("school password must be")) {
    return "학교 비밀번호를 입력해 주세요.";
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
