import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { getMyGroupAnonymousActivityRestriction } from "~/features/posts/data/queries";
import type { PostEngagement } from "~/features/posts/model/types";

const ANONYMOUS_ACTIVITY_RESTRICTION_STALE_TIME = 120_000;

export type { PostEngagement } from "~/features/posts/model/types";

export const postKeys = {
  all: ["posts"] as const,
  engagements: () => [...postKeys.all, "engagement"] as const,
  engagement: (postId: string) => [...postKeys.engagements(), postId] as const,
  anonymousActivityRestriction: (groupId: string) =>
    [...postKeys.all, "anonymous-activity-restriction", groupId] as const,
};

/**
 * 게시물 본문과 별도로 변하는 댓글 수·반응의 표시용 정본이다.
 *
 * 목록 원본과 미디어 수화본을 고치지 않아도 카드·행·상세가 같은 게시물의 최신 engagement를
 * 읽는다. QueryClient가 계정 전환에서 비워지므로 module-level 상태를 두지 않는다.
 */
export function patchPostEngagement(
  queryClient: QueryClient,
  postId: string,
  patch: Partial<PostEngagement>,
) {
  queryClient.setQueryData<Partial<PostEngagement>>(
    postKeys.engagement(postId),
    (current) => ({ ...current, ...patch }),
  );
}

/** 명시적으로 서버 snapshot을 다시 읽기 전, 이전 뮤테이션 표시값을 버린다. */
export function clearPostEngagement(queryClient: QueryClient, postId?: string) {
  queryClient.removeQueries({
    queryKey: postId ? postKeys.engagement(postId) : postKeys.engagements(),
  });
}

export function anonymousActivityRestrictionQuery(groupId: string) {
  return queryOptions({
    queryKey: postKeys.anonymousActivityRestriction(groupId),
    queryFn: () => getMyGroupAnonymousActivityRestriction(groupId),
    staleTime: ANONYMOUS_ACTIVITY_RESTRICTION_STALE_TIME,
    retry: false,
    retryOnMount: false,
  });
}
