import { removeFeedPost, resetFeed } from "~/features/feed";
import { groupKeys } from "~/features/groups";
import { getQueryClient } from "~/shared/lib/query-client";

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
