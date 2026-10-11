import type { FeedPost, FeedPostDetail } from "~/features/feed/model/types";
import type { GroupPostDetail } from "~/features/posts/model/types";

/**
 * 피드가 이미 든 글로 상세 창을 바로 연다. 피드 RPC에 없는 권한은 닫아 둔 채 그려서, 상세
 * 응답이 오기 전에는 수정·삭제·고정 메뉴가 보이지 않는다. 목록 보기에서는 첨부·아바타가 아직
 * 서명되지 않았을 수 있다 — 그 자리는 상세 응답이 채운다.
 */
export function previewFeedPostDetail(post: FeedPost): FeedPostDetail {
  if (post.kind === "group") {
    return {
      kind: "group",
      // 상세 타입은 생성기를 따라 null 가능한 열(`author_name`, `edited_at` 등)을 not null로
      // 적었고, 피드 타입은 그것을 바로잡았다. 실제 값의 모양은 같으므로 단언한다.
      post: {
        ...post,
        category_id: null,
        can_delete: false,
        can_edit: false,
        can_pin: false,
        can_moderate_anonymous: false,
        anonymous_author_restricted: false,
        anonymous_author_restriction_expires_at: null,
      } as unknown as GroupPostDetail,
      comments: null,
      slug: post.group_slug,
      groupName: post.group_name,
      group: null,
    };
  }
  return {
    kind: "profile",
    post: { ...post, can_delete: false, can_edit: false },
    comments: null,
  };
}
