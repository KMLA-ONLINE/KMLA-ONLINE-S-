import { PinIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import {
  CommentComposer,
  type CommentViewer,
} from "~/features/posts/components/comment-composer";
import { CommentThread } from "~/features/posts/components/comment-thread";
import { GroupPostActionBar } from "~/features/posts/components/group-post-action-bar";
import { GroupPostMenu } from "~/features/posts/components/group-post-menu";
import {
  PostFileList,
  PostImageGrid,
  splitPostAttachments,
} from "~/features/posts/components/post-attachments";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import type {
  GroupPostDetail,
  PostComment,
  PostCommentPage,
  PostIdentity,
} from "~/features/posts/model/types";
import { usePostComments } from "~/features/posts/hooks/use-post-comments";
import { useVisitedPosts } from "~/features/posts/hooks/use-visited-posts";
import { RelativeTime } from "~/shared/components/relative-time";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

/**
 * 모바일은 전체화면, 데스크톱은 가운데 정렬된 모달.
 *
 * 높이를 `h-[90svh]`로 고정한 것이 핵심이다. 내용에 맞춰 늘어나게 두면 짧은 게시물과 긴
 * 게시물 사이를 오갈 때 모달 크기가 매번 달라져서, 목록에서 하나씩 열어볼 때 창이 계속
 * 출렁인다. `svh`는 모바일 주소창이 접히며 높이가 변하는 것까지 막는다.
 */
const DETAIL_DIALOG_CLASS =
  "flex h-[90svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-2xl";

export function PostDetail({
  post,
  slug,
  viewer,
  identities,
  comments,
}: {
  post: GroupPostDetail;
  slug: string;
  /** 입력창 왼쪽 아바타에 쓰는 내 프로필. */
  viewer: CommentViewer;
  /** 이 그룹에서 댓글에 쓸 수 있는 작성 신원. 첫 항목이 기본값이다. */
  identities: PostIdentity[];
  comments: PostCommentPage;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const { markVisited } = useVisitedPosts();
  const close = useModalClose(`/groups/${slug}`);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const thread = usePostComments(post.post_id, comments);
  const [identity, setIdentity] = useState<PostIdentity>(identities[0]);

  const { images, files } = splitPostAttachments(post.attachments);
  const authorName = post.author_name || post.author_label;
  const postPath = `/groups/${slug}/posts/${post.post_id}`;

  useEffect(() => markVisited(post.post_id), [markVisited, post.post_id]);

  const submitIntent = (fields: Record<string, string>) =>
    void fetcher.submit(fields, { method: "post" });

  const submitComment = async (body: string) => {
    const created = await thread.create(body, identity, null);
    if (!created) return;
    // 방금 쓴 댓글은 목록 맨 아래에 붙는다. 보이지 않는 곳에 등록되면 실패로 읽힌다.
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
  };

  const submitReply = (parent: PostComment, body: string) =>
    thread.create(body, identity, parent.comment_id);

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className={DETAIL_DIALOG_CLASS}>
        <DialogHeader className="relative flex-row items-center justify-center border-b p-3">
          <DialogTitle className="text-base font-semibold">
            {authorName}님의 게시물
          </DialogTitle>
          <DialogDescription className="sr-only">
            게시물 상세와 댓글
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="닫기"
            onClick={close}
            className="absolute inset-y-0 right-3 my-auto text-muted-foreground"
          >
            <XIcon />
          </Button>
        </DialogHeader>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {fetcher.data?.error ? (
            <p role="alert" className="border-b p-3 text-sm text-destructive">
              {fetcher.data.error}
            </p>
          ) : null}
          <article>
            <div className="flex flex-col gap-3 p-4">
              {post.is_pinned ? (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <PinIcon className="size-3.5 -rotate-45 fill-current" />
                  고정된 게시물
                </div>
              ) : null}

              <header className="flex items-center gap-3">
                {post.author_identity !== "anonymous" && post.author_pub_id ? (
                  <Link
                    to={`/profile/${post.author_pub_id}`}
                    aria-label={`${authorName} 프로필`}
                  >
                    <PostAuthorAvatar
                      identity={post.author_identity}
                      name={post.author_name}
                      avatarPath={post.author_avatar_path}
                      size="lg"
                    />
                  </Link>
                ) : (
                  <PostAuthorAvatar
                    identity={post.author_identity}
                    name={post.author_name}
                    avatarPath={post.author_avatar_path}
                    size="lg"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {post.author_identity !== "anonymous" &&
                    post.author_pub_id ? (
                      <Link
                        to={`/profile/${post.author_pub_id}`}
                        className="truncate text-sm font-semibold hover:underline"
                      >
                        {authorName}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-semibold">
                        {authorName}
                      </span>
                    )}
                    {post.author_identity === "staff" ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 text-muted-foreground"
                      >
                        운영진
                      </Badge>
                    ) : null}
                    {post.is_author && post.author_identity !== "identified" ? (
                      <Badge variant="secondary" className="shrink-0">
                        나
                      </Badge>
                    ) : null}
                    {post.category_name ? (
                      <Badge variant="secondary" className="shrink-0">
                        {post.category_name}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <RelativeTime value={post.published_at} />
                  </div>
                </div>
                <GroupPostMenu
                  editTo={`${postPath}/edit`}
                  isPinned={post.is_pinned}
                  canEdit={post.can_edit}
                  canPin={post.can_pin}
                  canDelete={post.can_delete}
                  onPin={() =>
                    submitIntent({
                      intent: "pin",
                      pinned: String(!post.is_pinned),
                    })
                  }
                  onDelete={() => submitIntent({ intent: "delete" })}
                />
              </header>

              <div>
                <h2 className="mb-2 text-xl font-semibold">{post.title}</h2>
                <PostMarkdown>{post.body}</PostMarkdown>
              </div>

              {/* 카드와 달리 모달은 콘텐츠에 `p-4` 여백이 있으므로 그리드도 모서리를 둥글린다. */}
              <PostImageGrid
                images={images}
                className="overflow-hidden rounded-lg"
              />
              <PostFileList files={files} />
            </div>

            <GroupPostActionBar
              postId={post.post_id}
              reaction={{
                reaction_count: post.reaction_count,
                top_reactions: post.top_reactions,
                my_reaction: post.my_reaction,
              }}
              sharePath={postPath}
              shareTitle={post.title}
              commentCount={post.comment_count + thread.countDelta}
              onComment={() => composerRef.current?.focus()}
            />
          </article>

          <section className="border-t p-4">
            <CommentThread
              comments={thread.comments}
              replies={thread.replies}
              expanded={thread.expanded}
              hasOlder={thread.hasOlder}
              loading={thread.loading}
              pending={thread.pending}
              viewer={viewer}
              identities={identities}
              identity={identity}
              onIdentityChange={setIdentity}
              scrollRef={scrollRef}
              onLoadOlder={thread.loadOlder}
              onToggleReplies={thread.toggleReplies}
              onSubmitReply={submitReply}
              onEdit={thread.edit}
              onReact={thread.react}
              onDelete={thread.remove}
            />
          </section>
        </div>

        <CommentComposer
          viewer={viewer}
          identities={identities}
          identity={identity}
          onIdentityChange={setIdentity}
          onSubmit={submitComment}
          pending={thread.pending}
          error={thread.error}
          inputRef={composerRef}
        />
      </DialogContent>
    </Dialog>
  );
}
