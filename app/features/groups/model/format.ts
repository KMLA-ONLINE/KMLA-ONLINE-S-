import type {
  GroupIdentityPolicy,
  GroupJoinPolicy,
  GroupKind,
  GroupMemberRole,
  GroupPostingPolicy,
} from "~/features/groups/model/types";

const JOIN_POLICY_LABELS: Record<GroupJoinPolicy, string> = {
  open: "즉시 가입",
  request: "승인 가입",
  invite_only: "초대 전용",
};

const IDENTITY_POLICY_LABELS: Record<GroupIdentityPolicy, string> = {
  identified: "실명 활동",
  optional_anonymous: "익명 선택",
  always_anonymous: "항상 익명",
};

const POSTING_POLICY_LABELS: Record<GroupPostingPolicy, string> = {
  members: "모든 멤버",
  staff: "운영진만",
};

const MEMBER_ROLE_LABELS: Record<GroupMemberRole, string> = {
  owner: "소유자",
  admin: "관리자",
  manager: "매니저",
  member: "멤버",
};

export function getGroupJoinPolicyLabel(policy: GroupJoinPolicy): string {
  return JOIN_POLICY_LABELS[policy];
}

export function getGroupIdentityPolicyLabel(
  policy: GroupIdentityPolicy,
): string {
  return IDENTITY_POLICY_LABELS[policy];
}

export function getGroupPostingPolicyLabel(policy: GroupPostingPolicy): string {
  return POSTING_POLICY_LABELS[policy];
}

export function getGroupMemberRoleLabel(role: GroupMemberRole): string {
  return MEMBER_ROLE_LABELS[role];
}

export function getGroupKindLabel(kind: GroupKind): string {
  return kind === "official" ? "공식 그룹" : "비공식 그룹";
}

export function normalizeGroupSearchInput(value: string): string {
  return value.normalize("NFC").trim();
}

export function hasMinimumGroupSearchLength(value: string): boolean {
  return Array.from(normalizeGroupSearchInput(value)).length >= 1;
}

export function getGroupErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "요청을 처리하지 못했습니다.";

  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "23505") {
    return "이미 사용 중인 그룹 이름 또는 주소입니다.";
  }
  if (candidate.code === "23514" || candidate.code === "22023") {
    if (candidate.message?.includes("invite lifetime")) {
      return "초대 링크 기한은 1시간에서 2주 사이여야 합니다.";
    }
    return "입력한 그룹 정보를 다시 확인해 주세요.";
  }
  if (candidate.code === "42501") return "이 작업을 수행할 권한이 없습니다.";
  if (candidate.code === "P0002") {
    if (candidate.message?.includes("invite not found")) {
      return "쓸 수 없는 초대 링크입니다.";
    }
    return "그룹을 찾을 수 없습니다.";
  }
  // 55000은 "지금 이 그룹의 상태에서는 안 된다"는 뜻이라 이유마다 다른 조치가 필요하다.
  if (candidate.code === "55000") {
    if (candidate.message?.includes("lift anonymity")) {
      return "멤버가 있는 항상 익명 그룹은 활동 신원을 바꿀 수 없습니다.";
    }
    if (candidate.message?.includes("pending join requests")) {
      return "가입 요청을 모두 처리한 뒤에 바꿀 수 있습니다.";
    }
    if (candidate.message?.includes("become private")) {
      return "공개된 그룹은 비공개로 바꿀 수 없습니다.";
    }
    if (candidate.message?.includes("official groups cannot be deleted")) {
      return "공식 그룹은 삭제할 수 없습니다.";
    }
    if (
      candidate.message?.includes("official groups cannot become anonymous")
    ) {
      return "공식 그룹은 항상 익명으로 바꿀 수 없습니다.";
    }
    if (candidate.message?.includes("invite expired")) {
      return "기한이 지난 초대 링크입니다.";
    }
    if (candidate.message?.includes("cannot be invited to")) {
      return "공식 그룹은 초대 링크를 쓰지 않습니다.";
    }
    return "지금은 이 설정을 바꿀 수 없습니다.";
  }

  return "잠시 후 다시 시도해 주세요.";
}
