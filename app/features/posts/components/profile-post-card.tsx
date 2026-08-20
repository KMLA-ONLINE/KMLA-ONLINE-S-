import {
  PostFileList,
  PostImageGrid,
  splitPostAttachments,
} from "~/features/posts/components/post-attachments";
import { PostActionBar } from "~/features/posts/components/post-action-bar";
import { PostBodyClamp } from "~/features/posts/components/post-body-clamp";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { PostMenu } from "~/features/posts/components/post-menu";
import { ProfileMediaActivity } from "~/features/posts/components/profile-media-activity";
import {
  ProfilePostHeader,
  profilePostAuthorName,
  profilePostPath,
} from "~/features/posts/components/profile-post-header";
import type { ProfilePost } from "~/features/posts/model/types";

/**
 * 프로필 타임라인의 게시물 카드.
 *
 * 프레이밍과 본문 접기, 액션 바는 그룹 카드와 같은 것을 쓴다. 다른 것은 머리 줄뿐이다 —
 * 개인 게시물에는 제목과 카테고리와 고정이 없다(기능 명세 §8.1).
 */
export function ProfilePostCard({
  post,
  onDelete,
}: {
  post: ProfilePost;
  onDelete: () => void;
}) {
  const { images, files } = splitPostAttachments(post.attachments);
  const postPath = profilePostPath(post);

  return (
    <article className="overflow-hidden border-b-2 border-foreground/20 bg-card shadow-none md:rounded-xl md:border md:border-border md:shadow-sm">
      <div className="px-4 pt-4 pb-3">
        <ProfilePostHeader
          post={post}
          menu={
            <PostMenu
              editTo={`${postPath}/edit`}
              canEdit={post.can_edit}
              canDelete={post.can_delete}
              onDelete={onDelete}
            />
          }
        />
      </div>

      {post.activity_kind ? (
        <ProfileMediaActivity post={post} />
      ) : (
        <>
          <div className="px-4">
            <PostBodyClamp testId="profile-post-body">
              <PostMarkdown>{post.body}</PostMarkdown>
            </PostBodyClamp>
          </div>

          <PostImageGrid images={images} className="mt-3" />
          {files.length > 0 ? (
            <div className="mt-3 px-4">
              <PostFileList files={files} />
            </div>
          ) : null}
        </>
      )}

      <PostActionBar
        postId={post.post_id}
        reaction={{
          reaction_count: post.reaction_count,
          top_reactions: post.top_reactions,
          my_reaction: post.my_reaction,
        }}
        sharePath={postPath}
        shareTitle={`${profilePostAuthorName(post)}님의 게시물`}
        commentCount={post.comment_count}
        commentTo={postPath}
        className="mt-1"
      />
    </article>
  );
}
