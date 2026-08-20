import { useFetcher } from "react-router";

import type { CommentViewer } from "~/features/posts/components/comment-composer";
import {
  PostFileList,
  PostImageGrid,
  splitPostAttachments,
} from "~/features/posts/components/post-attachments";
import { PostDetailDialog } from "~/features/posts/components/post-detail-dialog";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { PostMenu } from "~/features/posts/components/post-menu";
import {
  ProfilePostHeader,
  profilePostAuthorName,
  profilePostPath,
} from "~/features/posts/components/profile-post-header";
import type {
  PostCommentPage,
  ProfilePost,
} from "~/features/posts/model/types";
import { useModalClose } from "~/shared/hooks/use-modal-close";

/**
 * 개인 게시물 상세 (기능 명세 §8.8).
 *
 * 그룹 상세와 같은 모달 껍데기를 쓰고 본문 영역만 갈아 끼운다. 댓글에 쓸 수 있는 신원은
 * 실명 하나뿐이라 입력창의 신원 전환 버튼이 나타나지 않는다(기능 명세 §9.1).
 */
export function ProfilePostDetail({
  post,
  viewer,
  comments,
}: {
  post: ProfilePost;
  /** 입력창 왼쪽 아바타에 쓰는 내 프로필. */
  viewer: CommentViewer;
  comments: PostCommentPage;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const close = useModalClose(`/profile/${post.timeline_pub_id}`);

  const { images, files } = splitPostAttachments(post.attachments);
  const authorName = profilePostAuthorName(post);
  const postPath = profilePostPath(post);

  return (
    <PostDetailDialog
      title={`${authorName}님의 게시물`}
      postId={post.post_id}
      comments={comments}
      viewer={viewer}
      identities={["identified"]}
      error={fetcher.data?.error}
      onClose={close}
      actionBar={{
        reaction: {
          reaction_count: post.reaction_count,
          top_reactions: post.top_reactions,
          my_reaction: post.my_reaction,
        },
        sharePath: postPath,
        shareTitle: `${authorName}님의 게시물`,
        commentCount: post.comment_count,
      }}
    >
      <div className="flex flex-col gap-3 p-4">
        <ProfilePostHeader
          post={post}
          align="center"
          menu={
            <PostMenu
              editTo={`${postPath}/edit`}
              canEdit={post.can_edit}
              canDelete={post.can_delete}
              onDelete={() =>
                void fetcher.submit({ intent: "delete" }, { method: "post" })
              }
            />
          }
        />

        <PostMarkdown>{post.body}</PostMarkdown>

        {/* 카드와 달리 모달은 콘텐츠에 `p-4` 여백이 있으므로 그리드도 모서리를 둥글린다. */}
        <PostImageGrid images={images} className="overflow-hidden rounded-lg" />
        <PostFileList files={files} />
      </div>
    </PostDetailDialog>
  );
}
