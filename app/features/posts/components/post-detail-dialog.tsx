import { XIcon } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";

import {
  CommentComposer,
  type CommentViewer,
} from "~/features/posts/components/comment-composer";
import { CommentThread } from "~/features/posts/components/comment-thread";
import { PostActionBar } from "~/features/posts/components/post-action-bar";
import { usePostComments } from "~/features/posts/hooks/use-post-comments";
import type {
  PostComment,
  PostCommentPage,
  PostIdentity,
  ReactionSummary,
} from "~/features/posts/model/types";
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

/**
 * 그룹 게시물과 개인 게시물 상세가 공유하는 껍데기.
 *
 * 두 상세가 다른 것은 본문 영역뿐이다 — 댓글 목록, 답글, 입력창, 스크롤 컨테이너와 모달
 * 프레이밍은 같다. 액션 바까지 여기서 그리는 이유는 그것이 방금 쓴 댓글을 더한 개수와 입력창
 * 포커스를 필요로 하는데, 둘 다 이 컴포넌트만 알고 있기 때문이다.
 */
export function PostDetailDialog({
  title,
  postId,
  comments,
  viewer,
  identities,
  error,
  onClose,
  actionBar,
  children,
}: {
  /** 모달 머리에 적는 제목. 낭독기에는 이것이 게시물의 이름이 된다. */
  title: string;
  postId: string;
  comments: PostCommentPage;
  /** 입력창 왼쪽 아바타에 쓰는 내 프로필. */
  viewer: CommentViewer;
  /** 이 게시물에 댓글로 쓸 수 있는 작성 신원. 첫 항목이 기본값이다. */
  identities: PostIdentity[];
  error?: string | null;
  onClose: () => void;
  /** 본문 아래 액션 바. 댓글 수는 서버가 준 값만 넘기면 된다 — 방금 쓴 댓글은 여기서 더한다. */
  actionBar: {
    reaction: ReactionSummary;
    sharePath: string;
    shareTitle: string;
    commentCount: number;
  };
  /** 게시물 본문 영역. 종류마다 다른 유일한 부분이다. */
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const thread = usePostComments(postId, comments);
  const [identity, setIdentity] = useState<PostIdentity>(identities[0]);

  // 본문 영역이 액션 바에서 부르는 핸들러다. JSX 안에서 즉석 클로저로 만들면 render 중에
  // ref를 읽는 것으로 잡힌다.
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);

  const submitComment = async (body: string) => {
    const created = await thread.create(body, identity, null);
    if (!created) return created;
    // 방금 쓴 댓글은 목록 맨 아래에 붙는다. 보이지 않는 곳에 등록되면 실패로 읽힌다.
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return created;
  };

  const submitReply = (parent: PostComment, body: string) =>
    thread.create(body, identity, parent.comment_id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className={DETAIL_DIALOG_CLASS}>
        <DialogHeader className="relative flex-row items-center justify-center border-b p-3">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            게시물 상세와 댓글
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="닫기"
            onClick={onClose}
            className="absolute inset-y-0 right-3 my-auto text-muted-foreground"
          >
            <XIcon />
          </Button>
        </DialogHeader>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <p role="alert" className="border-b p-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <article>
            {children}

            <PostActionBar
              postId={postId}
              reaction={actionBar.reaction}
              sharePath={actionBar.sharePath}
              shareTitle={actionBar.shareTitle}
              commentCount={actionBar.commentCount + thread.countDelta}
              onComment={focusComposer}
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
