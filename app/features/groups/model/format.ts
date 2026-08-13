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
  return Array.from(normalizeGroupSearchInput(value)).length >= 2;
}

export function getGroupErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "요청을 처리하지 못했습니다.";

  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "23505") {
    return "이미 사용 중인 그룹 이름 또는 주소입니다.";
  }
  if (candidate.code === "23514" || candidate.code === "22023") {
    return "입력한 그룹 정보를 다시 확인해 주세요.";
  }
  if (candidate.code === "42501") return "이 작업을 수행할 권한이 없습니다.";
  if (candidate.code === "P0002") return "그룹을 찾을 수 없습니다.";

  return "잠시 후 다시 시도해 주세요.";
}
