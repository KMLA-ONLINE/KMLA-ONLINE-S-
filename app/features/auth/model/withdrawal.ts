import { readErrorCode } from "~/features/auth/model/format";
import type { Database } from "~/shared/supabase/database.types";

export interface OwnedGroup {
  id: string;
  slug: string;
  name: string;
}

/** 탈퇴 전에 먼저 정리해야 하는 것. 최종 판정은 `withdraw_account` RPC가 다시 한다. */
export type WithdrawalBlocker =
  { kind: "app_admin" } | { kind: "group_owner"; groups: OwnedGroup[] };

export function getWithdrawalBlockers({
  role,
  ownedGroups,
}: {
  role: Database["public"]["Enums"]["app_role"];
  ownedGroups: OwnedGroup[];
}): WithdrawalBlocker[] {
  const blockers: WithdrawalBlocker[] = [];
  if (role === "admin") blockers.push({ kind: "app_admin" });
  if (ownedGroups.length > 0) {
    blockers.push({ kind: "group_owner", groups: ownedGroups });
  }
  return blockers;
}

/** 탈퇴 실패를 보여 줄 자리와 문구. 비밀번호 오류만 비밀번호 칸에 붙인다. */
export function describeWithdrawalError(error: unknown): {
  field: "password" | "form";
  message: string;
} {
  if (readErrorCode(error) === "invalid_credentials") {
    return { field: "password", message: "비밀번호가 올바르지 않습니다." };
  }
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  if (message === "group ownership must be transferred before withdrawal") {
    return {
      field: "form",
      message:
        "소유한 그룹이 있어 탈퇴할 수 없습니다. 먼저 소유권을 넘겨 주세요.",
    };
  }
  if (message === "app administrator role must be released before withdrawal") {
    return {
      field: "form",
      message:
        "앱 관리자는 탈퇴할 수 없습니다. 다른 앱 관리자에게 강등을 요청해 주세요.",
    };
  }
  return {
    field: "form",
    message: "탈퇴하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };
}
