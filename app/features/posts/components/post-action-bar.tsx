import { MessageCircleIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { PostReactionButton } from "~/features/posts/components/reaction/post-reaction-button";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { ReactionListDialog } from "~/features/posts/components/reaction/reaction-list-dialog";
import { usePostReaction } from "~/features/posts/hooks/use-post-reaction";
import { usePostEngagement } from "~/features/posts/hooks/use-post-engagement";
import type { ReactionSummary } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

const ACTION_CLASS =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground";

/**
 * 운영체제 공유 화면을 여는 기기. 폰·태블릿은 공유 시트가 메신저로 바로 이어지지만, 데스크톱
 * 브라우저의 공유 창은 쓸 곳이 마땅치 않아 링크 복사가 더 빠르다.
 */
const NATIVE_SHARE_QUERY = "(hover: none) and (pointer: coarse)";

/**
 * 게시물 하단 액션 바.
 *
 * 왼쪽은 조작(반응·댓글·공유), 오른쪽은 이 게시물에 달린 반응 요약이다. 요약을 누르면 누가
 * 무엇을 눌렀는지 목록이 열린다.
 *
 * 반응 상태는 이 컴포넌트가 통째로 들고 있다. 카드와 상세가 각자 같은 배선을 반복할 이유가
 * 없고, 반응은 게시물 본문과 달리 route 데이터를 다시 읽지 않고 제자리에서 갱신된다.
 *
 * 댓글은 목록에서는 댓글 진입 URL로 보내고(`commentTo`), 상세에서는 입력창으로 보낸다
 * (`onComment`). 카드가 `view=comments`를 붙이면 모바일에서만 댓글 시트로 표현된다.
 */
export function PostActionBar({
  postId,
  reaction,
  sharePath,
  shareTitle,
  commentCount,
  commentTo,
  commentState,
  onComment,
  className,
}: {
  postId: string;
  reaction: ReactionSummary;
  /** 게시물 상세의 앱 내부 경로. 절대 URL은 공유하는 순간에 만든다 — `window`를 render 중에 읽으면 build-time render가 깨진다. */
  sharePath: string;
  shareTitle: string;
  commentCount: number;
  commentTo?: string;
  /** 댓글 링크에 실어 보낼 navigation state. 그룹 카드가 상세의 그룹 링크를 감출 때 쓴다. */
  commentState?: unknown;
  onComment?: () => void;
  className?: string;
}) {
  const reactions = usePostReaction(postId, reaction);
  const engagement = usePostEngagement(postId, {
    ...reaction,
    comment_count: commentCount,
  });
  const [reactorsOpen, setReactorsOpen] = useState(false);

  const share = async () => {
    try {
      const url = new URL(sharePath, window.location.origin).toString();
      if (navigator.share && window.matchMedia(NATIVE_SHARE_QUERY).matches) {
        await navigator.share({ title: shareTitle, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("링크를 복사했습니다.");
    } catch (error) {
      // 공유 시트를 사용자가 닫은 것은 실패가 아니다.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("링크를 공유하지 못했습니다.");
    }
  };

  const commentLabel = `댓글 ${engagement.comment_count}개`;
  // 0은 숫자로 적지 않는다. 아직 아무도 남기지 않은 자리에 0이 붙으면 눈에 걸린다.
  const commentInner = (
    <>
      <MessageCircleIcon className="size-5" aria-hidden="true" />
      {engagement.comment_count > 0 ? engagement.comment_count : null}
    </>
  );

  return (
    <div
      className={cn(
        "flex items-center justify-between px-2 py-1 select-none",
        className,
      )}
    >
      <div className="flex items-center text-muted-foreground">
        <PostReactionButton
          summary={reactions.summary}
          onSelect={reactions.select}
          onClear={reactions.clear}
        />
        {commentTo ? (
          <Link
            to={commentTo}
            state={commentState}
            preventScrollReset
            aria-label={commentLabel}
            className={ACTION_CLASS}
          >
            {commentInner}
          </Link>
        ) : (
          <button
            type="button"
            aria-label={commentLabel}
            className={ACTION_CLASS}
            onClick={onComment}
          >
            {commentInner}
          </button>
        )}
        <button
          type="button"
          aria-label="공유"
          className={ACTION_CLASS}
          onClick={() => void share()}
        >
          <SendIcon className="size-5" aria-hidden="true" />
        </button>
      </div>

      {reactions.summary.reaction_count > 0 ? (
        <button
          type="button"
          aria-label={`반응 ${reactions.summary.reaction_count}개 보기`}
          className="-mr-1 flex items-center gap-0.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted"
          onClick={() => {
            setReactorsOpen(true);
            reactions.loadReactors();
          }}
        >
          {reactions.summary.top_reactions.map((item) => (
            <ReactionEmoji key={item} reaction={item} />
          ))}
        </button>
      ) : null}

      <ReactionListDialog
        open={reactorsOpen}
        onOpenChange={setReactorsOpen}
        reactors={reactions.reactors}
        loading={reactions.loadingReactors}
      />
    </div>
  );
}
