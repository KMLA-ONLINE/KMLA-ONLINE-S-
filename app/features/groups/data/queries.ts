import { getSupabase } from "~/shared/supabase/client";
import type { Database } from "~/shared/supabase/database.types";
import type {
  DiscoverGroupItem,
  GroupDiscoveryCursor,
  GroupDiscoveryPage,
  GroupDetail,
  GroupHomeItem,
  GroupMemberRole,
  GroupMembershipState,
  GroupSummary,
} from "~/features/groups/model/types";

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

  return [...official, ...mine, ...popular];
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

  return { groups, nextCursor };
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
  return {
    ...groupResult.data,
    group_id: groupResult.data.id,
    membership_state: membership ? "member" : request ? "requested" : "none",
    member_role: membership?.role ?? null,
    pinned_at: membership?.pinned_at ?? null,
    requested_at: request?.requested_at ?? null,
  };
}
