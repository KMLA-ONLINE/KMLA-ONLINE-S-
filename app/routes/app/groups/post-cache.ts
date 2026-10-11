import { useQuery } from "@tanstack/react-query";

import { removeFeedPost, resetFeed } from "~/features/feed";
import { groupKeys, GROUP_CONTENT_STALE_TIME } from "~/features/groups";
import { listGroupCategories, type GroupCategory } from "~/features/posts";
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

/** 삭제는 그 글만 빠지면 된다. 랭킹은 그대로 두고 캐시에서 덜어낸다. */
export async function invalidateDeletedGroupPost(
  groupId: string,
  postId: string,
) {
  removeFeedPost(getQueryClient(), postId);
  await invalidateGroupPostLists(groupId);
}

/** 고정은 그룹 안의 순서만 바꾼다. 전역 피드 랭킹과는 무관하다. */
export async function invalidateGroupPostOrder(groupId: string) {
  await invalidateGroupPostLists(groupId);
}
