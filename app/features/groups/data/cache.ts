import type { GroupDiscoveryCursor } from "~/features/groups/model/types";
import type { PostCursor } from "~/features/posts/model/types";
import type { QueryKey } from "@tanstack/react-query";

export const GROUP_STALE_TIME = 30_000;
export const GROUP_CONTENT_STALE_TIME = 15_000;

export const groupKeys = {
  all: ["groups"] as const,
  home: () => [...groupKeys.all, "home"] as const,
  discoveries: () => [...groupKeys.all, "discovery"] as const,
  discovery: (
    query: string,
    includeJoined: boolean,
    cursor: GroupDiscoveryCursor | null,
  ) => [...groupKeys.discoveries(), { query, includeJoined, cursor }] as const,
  details: () => [...groupKeys.all, "detail"] as const,
  detail: (slug: string) => [...groupKeys.details(), slug] as const,
  categories: (groupId: string) =>
    [...groupKeys.all, "categories", groupId] as const,
  postPages: (groupId: string) => [...groupKeys.all, "posts", groupId] as const,
  posts: (
    groupId: string,
    categoryId: string | null,
    cursor: PostCursor | null,
  ) => [...groupKeys.postPages(groupId), { categoryId, cursor }] as const,
  memberLists: (groupId: string) =>
    [...groupKeys.all, "members", groupId] as const,
  members: (groupId: string, query: string) =>
    [...groupKeys.memberLists(groupId), query] as const,
  joinRequests: (groupId: string) =>
    [...groupKeys.all, "join-requests", groupId] as const,
  invite: (groupId: string) => [...groupKeys.all, "invite", groupId] as const,
  reports: (groupId: string, sort: "count" | "recent") =>
    [...groupKeys.all, "reports", groupId, sort] as const,
};

export function isGroupAccessQuery(
  queryKey: QueryKey,
  groupId: string,
  slug: string,
) {
  return (
    queryKey[0] === groupKeys.all[0] &&
    (queryKey.includes(groupId) || queryKey.includes(slug))
  );
}
