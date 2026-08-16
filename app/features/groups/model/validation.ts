import type {
  CreateGroupErrors,
  CreateGroupValues,
  GroupIdentityPolicy,
  GroupJoinPolicy,
  GroupKind,
  GroupPostingPolicy,
} from "~/features/groups/model/types";

const GROUP_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,13}[a-z0-9]$/;
const RESERVED_GROUP_SLUGS = new Set(["create", "discover"]);
const GROUP_KINDS = new Set<GroupKind>(["official", "unofficial"]);
const JOIN_POLICIES = new Set<GroupJoinPolicy>([
  "open",
  "request",
  "invite_only",
]);
const IDENTITY_POLICIES = new Set<GroupIdentityPolicy>([
  "identified",
  "optional_anonymous",
  "always_anonymous",
]);
const POSTING_POLICIES = new Set<GroupPostingPolicy>(["members", "staff"]);

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function readCreateGroupForm(formData: FormData): CreateGroupValues {
  return {
    kind: formText(formData, "kind") as GroupKind,
    name: formText(formData, "name"),
    description: formText(formData, "description"),
    slug: formText(formData, "slug").toLowerCase(),
    joinPolicy: formText(formData, "joinPolicy") as GroupJoinPolicy,
    identityPolicy: formText(formData, "identityPolicy") as GroupIdentityPolicy,
    postingPolicy: formText(formData, "postingPolicy") as GroupPostingPolicy,
  };
}

export function validateCreateGroup(
  values: CreateGroupValues,
): CreateGroupErrors {
  const errors: CreateGroupErrors = {};

  if (!GROUP_KINDS.has(values.kind)) errors.kind = "그룹 종류를 선택해 주세요.";
  if (values.name.length < 1 || values.name.length > 50) {
    errors.name = "그룹 이름은 1자 이상 50자 이하로 입력해 주세요.";
  }
  if (values.description.length > 2000) {
    errors.description = "그룹 설명은 2,000자 이하로 입력해 주세요.";
  }
  if (!JOIN_POLICIES.has(values.joinPolicy)) {
    errors.joinPolicy = "가입 정책을 선택해 주세요.";
  }
  if (!IDENTITY_POLICIES.has(values.identityPolicy)) {
    errors.identityPolicy = "활동 신원 정책을 선택해 주세요.";
  }
  if (!POSTING_POLICIES.has(values.postingPolicy)) {
    errors.postingPolicy = "글쓰기 정책을 선택해 주세요.";
  }

  if (values.joinPolicy === "invite_only" && values.slug) {
    errors.slug = "초대 전용 그룹의 주소는 안전한 임의 주소로 생성됩니다.";
  } else if (
    values.slug &&
    (!GROUP_SLUG_PATTERN.test(values.slug) ||
      RESERVED_GROUP_SLUGS.has(values.slug))
  ) {
    errors.slug = "주소는 영문 소문자, 숫자, 하이픈으로 된 4~15자여야 합니다.";
  }

  return errors;
}

export function hasGroupFormErrors(errors: CreateGroupErrors): boolean {
  return Object.keys(errors).length > 0;
}
