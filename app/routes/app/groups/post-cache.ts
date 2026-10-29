import { useQuery } from "@tanstack/react-query";

import { removeFeedPost, resetFeed } from "~/features/feed";
import { groupKeys, GROUP_CONTENT_STALE_TIME } from "~/features/groups";
import {
  listGroupCategories,
  removeGroupPostFromLists,
  setGroupPostPinnedInLists,
  type GroupCategory,
} from "~/features/posts";
import { getQueryClient } from "~/shared/lib/query-client";

/** 그룹 loader와 글쓰기·수정 화면이 같은 키로 읽는 카테고리. */
export function groupCategoriesQuery(groupId: string) {
  return {
    queryKey: groupKeys.categories(groupId),
    queryFn: () => listGroupCategories(groupId),
    staleTime: GROUP_CONTENT_STALE_TIME,
  };
}

/**
 * 글쓰기·수정 화면의 카테고리. 부모 loader 값을 먼저 쓰되 캐시를 우선한다. 게시물 상세로 바로 들어오면
 * 부모는 상세를 막지 않으려고 카테고리를 기다리지 않고 `[]`로 넘기며, 상세를 닫고 글쓰기를 열어도 부모를
 * 다시 읽지 않는다. 그때 카테고리는 목록 칸을 위해 이미 받아 둔 캐시에 있다.
 */
export function useGroupEditorCategories(
  groupId: string,
  fallback: GroupCategory[],
): GroupCategory[] {
  const { data } = useQuery({
    ...groupCategoriesQuery(groupId),
    enabled: groupId !== "",
  });
  return data ?? fallback;
}

/**
 * 게시물 변경이 피드에 미치는 영향은 종류마다 다르고, 그 차이가 비싸다. 새 세션 하나는
 * 서버가 피드 전체를 다시 랭킹해 물리화하는 일이라, "그룹 게시물이 바뀌었다" 하나로
 * 뭉뚱그리면 카테고리 이름 바꾸기가 남의 피드 랭킹을 다시 계산하게 만든다.
 */
function invalidateGroupPostLists(groupId: string) {
  // 목록은 다음 loader가 첫 페이지부터 다시 받는다(`fetchGroupPosts`).
  return getQueryClient().invalidateQueries({
    queryKey: groupKeys.postPages(groupId),
    refetchType: "none",
  });
}

/** 새 글·수정은 랭킹에 들어가야 하므로 세션을 새로 연다. */
export async function invalidateSavedGroupPost(groupId: string) {
  await Promise.all([
    invalidateGroupPostLists(groupId),
    resetFeed(getQueryClient()),
  ]);
}

/**
 * 삭제는 그 글만 빠지면 된다. 피드 랭킹도 그룹 목록도 다시 받지 않고 캐시에서 덜어낸다. 그룹 loader는
 * 삭제 뒤 다시 돌지 않으므로(`shouldRevalidate`) 떠 있는 고정 섹션은 여기서 바로 다시 받는다. 검색
 * 결과는 열 때마다 다시 읽는다.
 */
export async function invalidateDeletedGroupPost(
  groupId: string,
  postId: string,
) {
  const queryClient = getQueryClient();
  removeFeedPost(queryClient, postId);
  removeGroupPostFromLists(queryClient, groupId, postId);
  await queryClient.invalidateQueries({
    queryKey: groupKeys.pinnedPosts(groupId),
  });
}

/**
 * 고정은 목록 순서를 바꾸지 않고 전역 피드 랭킹과도 무관하다. 목록은 그 글의 고정 아이콘만 고치고,
 * 고정 섹션만 다시 읽는다. 그룹 loader는 고정 뒤 다시 돌지 않으므로(`shouldRevalidate`) 떠 있는
 * 섹션은 여기서 바로 다시 받는다.
 */
export async function invalidatePinnedGroupPost(
  groupId: string,
  postId: string,
  pinned: boolean,
) {
  const queryClient = getQueryClient();
  setGroupPostPinnedInLists(queryClient, groupId, postId, pinned);
  await queryClient.invalidateQueries({
    queryKey: groupKeys.pinnedPosts(groupId),
  });
}
