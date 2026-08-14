import { getSupabase } from "~/shared/supabase/client";
import type { Database } from "~/shared/supabase/database.types";
import type {
  DiscoverGroupItem,
  GroupDiscoveryCursor,
  GroupDiscoveryPage,
  GroupDetail,
  GroupHomeItem,
  GroupJoinRequest,
  GroupMember,
  GroupMemberCursor,
  GroupMemberPage,
  GroupMemberRole,
  GroupMembershipState,
  GroupSummary,
} from "~/features/groups/model/types";
import { createGroupMediaUrls } from "~/features/groups/data/files";

type GroupRow = Database["public"]["Tables"]["groups"]["Row"];

const GROUP_COLUMNS =
  "id, slug, name, description, kind, join_policy, identity_policy, posting_policy, icon_path, cover_path, member_count" as const;

interface MembershipWithGroup {
  role: GroupMemberRole;
  pinned_at: string | null;
  groups: GroupSummary;
}

function asHomeItem(
  group: GroupSummary,
  values: {
    section: GroupHomeItem["section"];
    state: GroupMembershipState;
    role?: GroupMemberRole | null;
    pinnedAt?: string | null;
  },
): GroupHomeItem {
  return {
    ...group,
    group_id: group.id,
    section: values.section,
    membership_state: values.state,
    member_role: values.role ?? null,
    pinned_at: values.pinnedAt ?? null,
  };
}

export async function loadGroupHome(): Promise<GroupHomeItem[]> {
  const supabase = getSupabase();
  const [officialResult, membershipsResult, requestsResult, popularResult] =
    await Promise.all([
      supabase
        .from("groups")
        .select(GROUP_COLUMNS)
        .eq("kind", "official")
        .order("created_at", { ascending: false }),
      supabase
        .from("group_memberships")
        .select(`role, pinned_at, groups!inner(${GROUP_COLUMNS})`)
        .order("pinned_at", { ascending: false, nullsFirst: false }),
      supabase.from("group_join_requests").select("group_id, requested_at"),
      supabase.rpc("list_popular_groups", { p_limit: 3 }),
    ]);

  if (officialResult.error) throw officialResult.error;
  if (membershipsResult.error) throw membershipsResult.error;
  if (requestsResult.error) throw requestsResult.error;
  if (popularResult.error) throw popularResult.error;

  const memberships = membershipsResult.data as MembershipWithGroup[];
  const membershipByGroup = new Map(
    memberships.map((membership) => [membership.groups.id, membership]),
  );
  const requestedGroups = new Set(
    requestsResult.data.map((request) => request.group_id),
  );

  const official = (officialResult.data as GroupRow[]).map((group) => {
    const membership = membershipByGroup.get(group.id);
    return asHomeItem(group, {
      section: "official",
      state: membership
        ? "member"
        : requestedGroups.has(group.id)
          ? "requested"
          : "none",
      role: membership?.role,
      pinnedAt: membership?.pinned_at,
    });
  });

  const mine = memberships
    .filter((membership) => membership.groups.kind === "unofficial")
    .map((membership) =>
      asHomeItem(membership.groups, {
        section: "mine",
        state: "member",
        role: membership.role,
        pinnedAt: membership.pinned_at,
      }),
    );

  const popular = (popularResult.data ?? []).map((group) =>
    asHomeItem(
      {
        id: group.group_id,
        slug: group.slug,
        name: group.name,
        description: group.description,
        kind: "unofficial",
        join_policy: group.join_policy,
        identity_policy: group.identity_policy,
        posting_policy: "members",
        icon_path: group.icon_path,
        cover_path: group.cover_path,
        member_count: group.member_count,
      },
      {
        section: "popular",
        state: group.membership_state as GroupMembershipState,
      },
    ),
  );

  const items = [...official, ...mine, ...popular];
  const urls = await createGroupMediaUrls(
    items.flatMap((item) => [item.icon_path, item.cover_path]),
  );
  return items.map((item) => ({
    ...item,
    icon_path: item.icon_path ? (urls.get(item.icon_path) ?? null) : null,
    cover_path: item.cover_path ? (urls.get(item.cover_path) ?? null) : null,
  }));
}

const DISCOVERY_PAGE_SIZE = 12;

export async function discoverGroups({
  query,
  includeJoined,
  cursor,
}: {
  query: string;
  includeJoined: boolean;
  cursor?: GroupDiscoveryCursor | null;
}): Promise<GroupDiscoveryPage> {
  const { data, error } = await getSupabase().rpc("discover_groups", {
    p_query: query,
    p_include_joined: includeJoined,
    p_after_rank: cursor?.rank,
    p_after_member_count: cursor?.memberCount,
    p_after_id: cursor?.groupId,
    p_limit: DISCOVERY_PAGE_SIZE + 1,
  });
  if (error) throw error;

  const rows = (data ?? []) as DiscoverGroupItem[];
  const groups = rows.slice(0, DISCOVERY_PAGE_SIZE);
  const lastGroup = groups.at(-1);
  const nextCursor =
    rows.length > DISCOVERY_PAGE_SIZE && lastGroup
      ? {
          rank: lastGroup.sort_rank,
          memberCount: lastGroup.member_count,
          groupId: lastGroup.group_id,
        }
      : null;

  const urls = await createGroupMediaUrls(
    groups.flatMap((group) => [group.icon_path, group.cover_path]),
  );
  return {
    groups: groups.map((group) => ({
      ...group,
      icon_path: group.icon_path ? (urls.get(group.icon_path) ?? null) : null,
      cover_path: group.cover_path
        ? (urls.get(group.cover_path) ?? null)
        : null,
    })),
    nextCursor,
  };
}

export async function loadGroupDetail(
  slug: string,
): Promise<GroupDetail | null> {
  const supabase = getSupabase();
  const [groupResult, membershipResult, requestResult] = await Promise.all([
    supabase
      .from("groups")
      .select(GROUP_COLUMNS)
      .eq("slug", slug)
      .maybeSingle(),
    supabase
      .from("group_memberships")
      .select("role, pinned_at, groups!inner(slug)")
      .eq("groups.slug", slug)
      .maybeSingle(),
    supabase
      .from("group_join_requests")
      .select("requested_at, groups!inner(slug)")
      .eq("groups.slug", slug)
      .maybeSingle(),
  ]);

  if (groupResult.error) throw groupResult.error;
  if (membershipResult.error) throw membershipResult.error;
  if (requestResult.error) throw requestResult.error;
  if (!groupResult.data) return null;

  const membership = membershipResult.data;
  const request = requestResult.data;
  const urls = await createGroupMediaUrls([
    groupResult.data.icon_path,
    groupResult.data.cover_path,
  ]);
  return {
    ...groupResult.data,
    icon_path: groupResult.data.icon_path
      ? (urls.get(groupResult.data.icon_path) ?? null)
      : null,
    cover_path: groupResult.data.cover_path
      ? (urls.get(groupResult.data.cover_path) ?? null)
      : null,
    group_id: groupResult.data.id,
    membership_state: membership ? "member" : request ? "requested" : "none",
    member_role: membership?.role ?? null,
    pinned_at: membership?.pinned_at ?? null,
    requested_at: request?.requested_at ?? null,
  };
}

export async function listGroupMembers(
  groupId: string,
  query = "",
  cursor: GroupMemberCursor | null = null,
): Promise<GroupMemberPage> {
  const pageSize = 30;
  const { data, error } = await getSupabase().rpc("list_group_members", {
    p_group_id: groupId,
    p_query: query,
    p_after_role: cursor?.role,
    p_after_joined_at: cursor?.joinedAt,
    p_after_membership_id: cursor?.membershipId,
    p_limit: pageSize + 1,
  });
  if (error) throw error;

  const rows = (data ?? []) as GroupMember[];
  const members = rows.slice(0, pageSize);
  const last = members.at(-1);
  return {
    members,
    nextCursor:
      rows.length > pageSize && last
        ? {
            role: last.role,
            joinedAt: last.joined_at,
            membershipId: last.membership_id,
          }
        : null,
  };
}

export async function listGroupJoinRequests(
  groupId: string,
): Promise<GroupJoinRequest[]> {
  const { data, error } = await getSupabase().rpc("list_group_join_requests", {
    p_group_id: groupId,
  });
  if (error) throw error;
  return data ?? [];
}
