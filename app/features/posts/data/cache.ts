import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import {
  GROUP_CONTENT_STALE_TIME,
  groupKeys,
} from "~/features/groups/data/cache";
import {
  getMyGroupAnonymousActivityRestriction,
  listGroupPinnedPosts,
  listGroupPosts,
  listPostPreviews,
} from "~/features/posts/data/queries";
import type {
  GroupPost,
  GroupPostPage,
  PostCursor,
  PostEngagement,
  PostPreview,
} from "~/features/posts/model/types";
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

/**
 * 고정 게시물. 그룹 loader가 첫 페이지와 함께 기다리고 목록 패널이 이 쿼리로 읽는다 — 섹션이
 * 펼친 채 목록 위에 서므로 늦게 뜨면 읽던 목록을 아래로 민다.
 */
export function groupPinnedPostsQuery(groupId: string) {
  return queryOptions({
    queryKey: groupKeys.pinnedPosts(groupId),
    queryFn: () => listGroupPinnedPosts(groupId),
    staleTime: GROUP_CONTENT_STALE_TIME,
  });
}

export type GroupPostsData = InfiniteData<GroupPostPage, PostCursor | null>;

/**
 * 그룹 게시물 목록. 카테고리마다 무한 쿼리 하나에 페이지를 쌓는다. 화면은 이 캐시만 그리므로 고정·삭제는
 * 다시 받지 않고 캐시를 고치고, 재검증이 돌아도 쌓은 페이지와 고른 카테고리가 남는다.
 *
 * 무한 쿼리를 그냥 refetch하면 쌓인 페이지를 전부 차례로 다시 받는다(페이지마다 RPC와 서명). 그래서
 * 마운트·포커스로는 다시 읽지 않고, 낡은 목록은 `fetchGroupPosts`가 첫 페이지로 줄여 한 번만 받는다.
 * 미디어 서명 여부(`hydrateMedia`)는 키에 넣지 않는다 — 보기 방식이 바뀌어도 같은 목록이다.
 */
export function groupPostsQuery(
  groupId: string,
  categoryId: string | null,
  hydrateMedia: boolean,
) {
  return infiniteQueryOptions({
    queryKey: groupKeys.posts(groupId, categoryId),
    queryFn: ({ pageParam }) =>
      listGroupPosts(groupId, { categoryId, cursor: pageParam, hydrateMedia }),
    initialPageParam: null as PostCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: GROUP_CONTENT_STALE_TIME,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

/** 낡았으면 첫 페이지부터 다시 받고, 아니면 캐시를 그대로 준다. loader와 카테고리 전환이 부른다. */
export function fetchGroupPosts(
  queryClient: QueryClient,
  groupId: string,
  categoryId: string | null,
  hydrateMedia: boolean,
) {
  const options = groupPostsQuery(groupId, categoryId, hydrateMedia);
  const query = queryClient
    .getQueryCache()
    .find<GroupPostPage, Error, GroupPostsData>({
      queryKey: options.queryKey,
      exact: true,
    });
  const loaded = query?.state.data;
  if (
    !query ||
    !loaded ||
    loaded.pages.length <= 1 ||
    !query.isStaleByTime(GROUP_CONTENT_STALE_TIME)
  )
    return queryClient.fetchInfiniteQuery(options);

  const { dataUpdatedAt } = query.state;
  updateGroupPostsData(queryClient, options.queryKey, (data) => ({
    pages: data.pages.slice(0, 1),
    pageParams: data.pageParams.slice(0, 1),
  }));
  const trimmed = query.state.data;
  // 실패하면 줄이기 전 페이지를 돌려놓는다. 그사이 다른 갱신이 캐시를 바꿨으면 그쪽이 맞다.
  return queryClient.fetchInfiniteQuery(options).catch((error: unknown) => {
    if (query.state.data === trimmed) {
      queryClient.setQueryData(options.queryKey, loaded, {
        updatedAt: dataUpdatedAt,
      });
      query.invalidate();
    }
    throw error;
  });
}

/**
 * 받아 둔 목록을 고친다. 받은 시각과 무효화 표시는 그대로 둔다 — 고친 것은 서버에서 다시 읽은 것이
 * 아니므로 낡은 목록을 신선하게 만들면 다음 loader가 새 글을 놓친다.
 */
export function updateGroupPostsData(
  queryClient: QueryClient,
  queryKey: QueryKey,
  update: (data: GroupPostsData) => GroupPostsData,
) {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query?.state.data) return;
  const { dataUpdatedAt, isInvalidated } = query.state;
  queryClient.setQueryData<GroupPostsData>(
    queryKey,
    (data) => data && update(data),
    { updatedAt: dataUpdatedAt },
  );
  if (isInvalidated) query.invalidate();
}

/** 그룹의 모든 카테고리 목록에서 그 게시물을 고친다. `null`을 돌려주면 목록에서 뺀다. */
function patchGroupPostLists(
  queryClient: QueryClient,
  groupId: string,
  postId: string,
  patch: (post: GroupPost) => GroupPost | null,
) {
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: groupKeys.postLists(groupId) })) {
    updateGroupPostsData(queryClient, query.queryKey, (data) => ({
      ...data,
      // 그 글이 없는 페이지는 그대로 두어야 진행 중인 미디어 서명이 페이지를 알아본다.
      pages: data.pages.map((page) => {
        if (!page.posts.some((post) => post.post_id === postId)) return page;
        return {
          ...page,
          posts: page.posts.flatMap((post) => {
            if (post.post_id !== postId) return [post];
            const next = patch(post);
            return next ? [next] : [];
          }),
        };
      }),
    }));
  }
}

export function setGroupPostPinnedInLists(
  queryClient: QueryClient,
  groupId: string,
  postId: string,
  pinned: boolean,
) {
  patchGroupPostLists(queryClient, groupId, postId, (post) =>
    post.is_pinned === pinned ? post : { ...post, is_pinned: pinned },
  );
}

/** 지운 글을 목록에서 뺀다. 다음 페이지 커서는 지운 글을 가리켜도 시각 비교라 그대로 이어진다. */
export function removeGroupPostFromLists(
  queryClient: QueryClient,
  groupId: string,
  postId: string,
) {
  patchGroupPostLists(queryClient, groupId, postId, () => null);
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

/**
 * 그룹을 나가 읽을 수 있는 게시물이 줄었을 때 메시지 안 카드를 모두 다시 읽게 한다. 어느 카드가 그
 * 그룹 글인지 클라이언트는 모르므로 전부 무효화한다 — 화면에 떠 있는 카드만 다시 받는다.
 */
export function invalidatePostPreviews() {
  void getQueryClient().invalidateQueries({
    queryKey: [...postKeys.all, "preview"],
  });
}

/** 메시지 안 게시물 카드 하나. 같은 tick에 그려지는 카드들은 한 번의 RPC로 묶어 읽는다. */
export function postPreviewQuery(postId: string) {
  return queryOptions({
    queryKey: postKeys.preview(postId),
    queryFn: () => loadPostPreview(postId),
    staleTime: POST_PREVIEW_STALE_TIME,
    // staleTime만으로는 다시 읽지 않는다. 대화방을 열어 둔 동안에도 남이 지우거나 비공개로 돌린 게시물,
    // 내보내진 그룹의 게시물이 2분 안에 바뀌게 화면에 떠 있는 카드만 주기적으로 다시 읽는다. 같은 순간에
    // 그려진 카드는 같은 tick에 다시 읽혀 한 번의 RPC로 묶인다.
    refetchInterval: POST_PREVIEW_STALE_TIME,
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
