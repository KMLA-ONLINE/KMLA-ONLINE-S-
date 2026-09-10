import { queryOptions } from "@tanstack/react-query";

import { getMyGroupAnonymousActivityRestriction } from "~/features/posts/data/queries";

const ANONYMOUS_ACTIVITY_RESTRICTION_STALE_TIME = 120_000;

const postKeys = {
  all: ["posts"] as const,
  anonymousActivityRestriction: (groupId: string) =>
    [...postKeys.all, "anonymous-activity-restriction", groupId] as const,
};

export function anonymousActivityRestrictionQuery(groupId: string) {
  return queryOptions({
    queryKey: postKeys.anonymousActivityRestriction(groupId),
    queryFn: () => getMyGroupAnonymousActivityRestriction(groupId),
    staleTime: ANONYMOUS_ACTIVITY_RESTRICTION_STALE_TIME,
    retry: false,
    retryOnMount: false,
  });
}
