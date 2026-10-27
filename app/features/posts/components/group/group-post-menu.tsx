import { PostMenu } from "~/features/posts/components/post-menu";
import { groupPostPath } from "~/features/posts/model/navigation";
import type { GroupPost, GroupPostDetail } from "~/features/posts/model/types";

/** 그룹 게시물 더보기 메뉴. 카드와 상세의 권한 필드 배선을 한 곳에 둔다. */
export function GroupPostMenu({
  post,
  slug,
  editState,
  onPin,
  onFeature,
  onDelete,
}: {
  post: GroupPost | GroupPostDetail;
  slug: string;
  editState?: unknown;
  onPin: () => void;
  onFeature: () => void;
  onDelete: () => void;
}) {
  return (
    <PostMenu
      editTo={`${groupPostPath(slug, post.post_id)}/edit`}
      editState={editState}
      isPinned={post.is_pinned}
      isFeatured={post.is_featured}
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
      onFeature={onFeature}
      onDelete={onDelete}
    />
  );
}
