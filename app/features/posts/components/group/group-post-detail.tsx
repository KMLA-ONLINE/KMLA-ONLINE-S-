import { useEffect } from "react";
import { Link, useFetcher, useLocation } from "react-router";

import type { CommentViewer } from "~/features/posts/components/comment/comment-composer";
import {
  PostFileList,
  PostImageGrid,
} from "~/features/posts/components/post-attachments";
import { splitPostAttachments } from "~/features/posts/model/attachments";
import { PostDetailDialog } from "~/features/posts/components/post-detail-dialog";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import type {
  GroupPostDetail as GroupPostDetailModel,
  PostCommentPage,
  PostIdentity,
  AnonymousActivityRestriction,
} from "~/features/posts/model/types";
import { GroupPostHeader } from "~/features/posts/components/group/group-post-header";
import { GroupPostMenu } from "~/features/posts/components/group/group-post-menu";
import { postAuthorName } from "~/features/posts/model/identity";
import { groupPostPath, isFromGroup } from "~/features/posts/model/navigation";
import { useVisitedPosts } from "~/features/posts/hooks/use-visited-posts";
import { useModalClose } from "~/shared/hooks/use-modal-close";

export function GroupPostDetail({
  post,
  slug,
  groupName,
  viewer,
  identities,
  comments,
  onClose,
  action,
  anonymousActivityRestriction,
}: {
  post: GroupPostDetailModel;
  slug: string;
  /** 머리의 그룹 링크에 쓴다. 상세 RPC는 이름을 돌려주지 않아 화면이 들고 있던 값을 받는다. */
  groupName: string;
  viewer: CommentViewer;
  /** 이 그룹에서 댓글에 쓸 수 있는 작성 신원. 첫 항목이 기본값이다. */
  identities: PostIdentity[];
  comments: PostCommentPage;
  onClose?: () => void;
  action?: string;
  anonymousActivityRestriction?: AnonymousActivityRestriction | null;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const { markVisited } = useVisitedPosts();
  // 그룹 안에서 들어왔으면 뒤로가기가 이미 그룹을 내놓는다. 피드는 route가 아니라 오버레이라
  // state가 없고, 알림과 공유 링크도 심어 줄 이유가 없어 거기서는 링크가 남는다.
  const fromGroup = isFromGroup(useLocation().state);
  const defaultClose = useModalClose(`/groups/${slug}`);
  const close = onClose ?? defaultClose;

  // 실명·운영진 게시물의 작성자는 자기 글에 익명 댓글을 못 단다(기능 명세 §9.1). DB가 최종 경계지만 고를 수 없는 신원은 아예 지운다.
  const commentIdentities =
    post.is_author && post.author_identity !== "anonymous"
      ? identities.filter((identity) => identity !== "anonymous")
      : identities;

  const { images, files } = splitPostAttachments(post.attachments);
  const authorName = postAuthorName(post);
  const postPath = groupPostPath(slug, post.post_id);

  useEffect(() => markVisited(post.post_id), [markVisited, post.post_id]);

  const submitIntent = (fields: Record<string, string>) =>
    void fetcher.submit(fields, { method: "post", action });

  return (
    <PostDetailDialog
      title={`${authorName}님의 게시물`}
      postId={post.post_id}
      comments={comments}
      viewer={viewer}
      identities={commentIdentities}
      postAuthorPubId={post.author_pub_id}
      mentionGroupId={post.group_id}
      error={fetcher.data?.error}
      anonymousActivityRestriction={anonymousActivityRestriction}
      onClose={close}
      actionBar={{
        reaction: {
          reaction_count: post.reaction_count,
          top_reactions: post.top_reactions,
          my_reaction: post.my_reaction,
        },
        sharePath: postPath,
        shareTitle: post.title,
        commentCount: post.comment_count,
      }}
    >
      <div className="flex flex-col gap-3 p-4">
        {/*
          링크로 곧장 들어오면 그룹 단서가 없고 뒤로가기는 온 곳으로 가야 하므로
          (`routes/notification-open.tsx`) 그룹 이동은 이 링크가 맡는다.
          카테고리·고정 표시는 목록용이라 상세에 두지 않는다(기능 명세 §8.8).
        */}
        {fromGroup ? null : (
          <Link
            to={`/groups/${slug}`}
            className="w-fit max-w-full truncate text-xs font-medium text-muted-foreground hover:underline"
          >
            {groupName} 그룹으로 이동
          </Link>
        )}

        <GroupPostHeader
          post={post}
          align="center"
          menu={
            <GroupPostMenu
              post={post}
              slug={slug}
              onPin={() =>
                submitIntent({
                  intent: "pin",
                  pinned: String(!post.is_pinned),
                })
              }
              onDelete={() => submitIntent({ intent: "delete" })}
            />
          }
        />

        <div>
          <h2 className="mb-2 text-xl font-semibold">{post.title}</h2>
          <PostMarkdown mentions={post.mentions}>{post.body}</PostMarkdown>
        </div>

        <PostImageGrid
          images={images}
          className="overflow-hidden rounded-lg"
          allowOriginalTile
        />
        <PostFileList files={files} />
      </div>
    </PostDetailDialog>
  );
}
