import type { Database } from "~/shared/supabase/database.types";

type GroupRow = Database["public"]["Tables"]["groups"]["Row"];
type GroupDiscoverRow =
  Database["public"]["Functions"]["discover_groups"]["Returns"][number];

export type GroupKind = Database["public"]["Enums"]["group_kind"];
export type GroupJoinPolicy = Database["public"]["Enums"]["group_join_policy"];
export type GroupIdentityPolicy =
  Database["public"]["Enums"]["group_identity_policy"];
export type GroupPostingPolicy =
  Database["public"]["Enums"]["group_posting_policy"];
export type GroupMemberRole = Database["public"]["Enums"]["group_member_role"];

export type GroupMembershipState = "member" | "requested" | "none";
export type GroupHomeSection = "official" | "mine";

export type GroupSummary = Pick<
  GroupRow,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "kind"
  | "join_policy"
  | "identity_policy"
  | "posting_policy"
  | "icon_path"
  | "cover_path"
  | "member_count"
>;

export type GroupHomeItem = GroupSummary & {
  group_id: GroupRow["id"];
  section: GroupHomeSection;
  membership_state: GroupMembershipState;
  member_role: GroupMemberRole | null;
  pinned_at: string | null;
};

export type DiscoverGroupItem = Omit<
  GroupDiscoverRow,
  | "membership_state"
  | "icon_path"
  | "cover_path"
  | "member_role"
  | "requested_at"
> & {
  membership_state: GroupMembershipState;
  icon_path: string | null;
  cover_path: string | null;
  member_role: GroupMemberRole | null;
  requested_at: string | null;
};

export interface GroupDiscoveryCursor {
  rank: number;
  memberCount: number;
  groupId: string;
}

export interface GroupDiscoveryPage {
  groups: DiscoverGroupItem[];
  nextCursor: GroupDiscoveryCursor | null;
}

export interface GroupMemberCursor {
  role: GroupMemberRole;
  joinedAt: string;
  membershipId: string;
}

export interface GroupMemberPage {
  members: GroupMember[];
  nextCursor: GroupMemberCursor | null;
}

export type GroupDetail = GroupSummary & {
  group_id: GroupRow["id"];
  membership_state: GroupMembershipState;
  member_role: GroupMemberRole | null;
  requested_at: string | null;
  pinned_at: string | null;
};

export interface CreateGroupValues {
  kind: GroupKind;
  name: string;
  description: string;
  slug: string;
  joinPolicy: GroupJoinPolicy;
  identityPolicy: GroupIdentityPolicy;
  postingPolicy: GroupPostingPolicy;
}

/** Presentation-safe member row returned by `list_group_members`. */
export interface GroupMember {
  membership_id: string;
  role: GroupMemberRole;
  joined_at: string;
  cohort: number | null;
  is_returning_student: boolean;
  pub_id: string;
  name: string;
  avatar_path: string | null;
}

/** Presentation-safe pending request returned by `list_group_join_requests`. */
export interface GroupJoinRequest {
  request_id: string;
  requested_at: string;
  cohort: number | null;
  is_returning_student: boolean;
  pub_id: string;
  name: string;
  avatar_path: string | null;
}

/** 그룹당 하나만 살아 있는 초대 링크. 재발급하면 이전 토큰은 사라진다. */
export type GroupInvite =
  Database["public"]["Functions"]["get_group_invite"]["Returns"][number];

/**
 * 링크를 받은 사람에게 보여 줄 만큼의 그룹 정보.
 *
 * 아이콘과 커버가 없는 것은 빠뜨린 게 아니다. 저장소 정책이 비멤버에게 비공개 그룹의 이미지를
 * 내주지 않고, 미리보기 한 장 때문에 그 정책을 넓히지 않기로 했다.
 */
export type GroupInvitePreview =
  Database["public"]["Functions"]["get_group_invite_preview"]["Returns"][number];

export interface UpdateGroupSettingsValues {
  name: string;
  description: string;
  joinPolicy: GroupJoinPolicy;
  identityPolicy: GroupIdentityPolicy;
  postingPolicy: GroupPostingPolicy;
}

export type GroupMediaSlot = Database["public"]["Enums"]["group_media_slot"];

export type CreateGroupField = keyof CreateGroupValues | "form";
export type CreateGroupErrors = Partial<Record<CreateGroupField, string>>;
