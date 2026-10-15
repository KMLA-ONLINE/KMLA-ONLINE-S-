import { queryOptions, type QueryClient } from "@tanstack/react-query";

import {
  getMyGroupAnonymousActivityRestriction,
  listPostPreviews,
} from "~/features/posts/data/queries";
import type { PostEngagement, PostPreview } from "~/features/posts/model/types";
import { getQueryClient } from "~/shared/lib/query-client";

const ANONYMOUS_ACTIVITY_RESTRICTION_STALE_TIME = 120_000;
const POST_PREVIEW_STALE_TIME = 120_000;

export type { PostEngagement } from "~/features/posts/model/types";

export const postKeys = {
  all: ["posts"] as const,
  engagements: () => [...postKeys.all, "engagement"] as const,
  engagement: (postId: string) => [...postKeys.engagements(), postId] as const,
  anonymousActivityRestriction: (groupId: string) =>
    [...postKeys.all, "anonymous-activity-restriction", groupId] as const,
  preview: (postId: string) => [...postKeys.all, "preview", postId] as const,
};

/** 본문과 별도로 변하는 댓글 수·반응의 표시용 정본. QueryClient가 계정 전환에서 비워지므로 module-level 상태를 두지 않는다. */
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

/**
 * 게시물을 고치거나 지운 뒤 메시지 안 그 게시물 카드를 다시 읽게 한다. 화면에 떠 있으면 바로 다시
 * 받고, 지운 게시물은 `볼 수 없는 게시물`로 바뀐다.
 */
export function invalidatePostPreview(postId: string) {
  void getQueryClient().invalidateQueries({
    queryKey: postKeys.preview(postId),
  });
}

/** 메시지 안 게시물 카드 하나. 같은 tick에 그려지는 카드들은 한 번의 RPC로 묶어 읽는다. */
export function postPreviewQuery(postId: string) {
  return queryOptions({
    queryKey: postKeys.preview(postId),
    queryFn: () => loadPostPreview(postId),
    staleTime: POST_PREVIEW_STALE_TIME,
  });
}

interface PendingPreview {
  resolve: (preview: PostPreview | null) => void;
  reject: (error: unknown) => void;
}

// 한 tick 동안만 사는 요청 묶음이다. 결과는 QueryClient에만 남으므로 계정 전환 정리와 충돌하지 않는다.
let pendingPreviews: Map<string, PendingPreview[]> | null = null;

function loadPostPreview(postId: string): Promise<PostPreview | null> {
  return new Promise((resolve, reject) => {
    if (!pendingPreviews) {
      pendingPreviews = new Map();
      setTimeout(() => void flushPostPreviews(), 0);
    }
    const waiting = pendingPreviews.get(postId) ?? [];
    waiting.push({ resolve, reject });
    pendingPreviews.set(postId, waiting);
  });
}

async function flushPostPreviews() {
  const batch = pendingPreviews;
  pendingPreviews = null;
  if (!batch) return;
  try {
    const previews = await listPostPreviews([...batch.keys()]);
    for (const [postId, waiting] of batch) {
      for (const entry of waiting) entry.resolve(previews.get(postId) ?? null);
    }
  } catch (error) {
    for (const waiting of batch.values()) {
      for (const entry of waiting) entry.reject(error);
    }
  }
}
