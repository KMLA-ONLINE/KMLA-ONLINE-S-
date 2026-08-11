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
export type GroupHomeSection = "official" | "mine" | "popular";

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

export type CreateGroupField = keyof CreateGroupValues | "form";
export type CreateGroupErrors = Partial<Record<CreateGroupField, string>>;
