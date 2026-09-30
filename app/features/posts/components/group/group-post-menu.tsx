import { PostMenu } from "~/features/posts/components/post-menu";
import { groupPostPath } from "~/features/posts/model/navigation";
import type { GroupPost, GroupPostDetail } from "~/features/posts/model/types";

/**
 * 그룹 게시물의 더보기 메뉴. 카드와 상세가 같은 권한 필드를 `PostMenu`에 같은 방식으로
 * 이어 주므로 그 배선을 여기 한 곳에 둔다 — 한쪽에서 필드를 빠뜨려도 타입이 잡아주지 못한다.
 */
export function GroupPostMenu({
  post,
  slug,
  onPin,
  onDelete,
}: {
  post: GroupPost | GroupPostDetail;
  slug: string;
  onPin: () => void;
  onDelete: () => void;
}) {
  return (
    <PostMenu
      editTo={`${groupPostPath(slug, post.post_id)}/edit`}
      isPinned={post.is_pinned}
      canEdit={post.can_edit}
      canPin={post.can_pin}
      canDelete={post.can_delete}
      canReport={!post.is_author}
      reportPostId={post.post_id}
      canModerateAnonymous={
        post.author_identity === "anonymous" && post.can_moderate_anonymous
      }
      anonymousAuthorRestricted={post.anonymous_author_restricted}
      anonymousAuthorRestrictionExpiresAt={
        post.anonymous_author_restriction_expires_at
      }
      anonymousSourceId={post.post_id}
      onPin={onPin}
      onDelete={onDelete}
    />
  );
}
