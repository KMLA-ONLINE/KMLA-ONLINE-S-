import { MessageCircleIcon, SendIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { Link } from "react-router";

import { SharePostDialog } from "~/features/messaging/components/share-post-dialog";
import { PostReactionButton } from "~/features/posts/components/reaction/post-reaction-button";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { ReactionListDialog } from "~/features/posts/components/reaction/reaction-list-dialog";
import { usePostReaction } from "~/features/posts/hooks/use-post-reaction";
import { useReactionListParam } from "~/features/posts/hooks/use-reaction-list-param";
import { usePostEngagement } from "~/features/posts/hooks/use-post-engagement";
import type { ReactionSummary } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

const ACTION_CLASS =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground";

/**
 * 게시물 하단 액션 바(반응·댓글·공유 + 반응 요약). 반응 상태는 여기서 들고 route를 다시 읽지 않고 제자리에서 갱신한다.
 * 목록은 `commentTo` URL로, 상세는 `onComment`로 입력창에 보낸다.
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
  /** 게시물 상세의 앱 내부 경로. 절대 URL은 보내는 순간에 만든다 — `window`를 render 중에 읽으면 build-time render가 깨진다. */
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
  const reactorList = useReactionListParam(`post:${postId}`);
  const loadReactors = useEffectEvent(reactions.loadReactors);
  // 뒤로 갔다가 앞으로 와서 다시 열려도 목록이 비지 않게, 누를 때가 아니라 열릴 때 받는다.
  useEffect(() => {
    if (reactorList.open) loadReactors();
  }, [reactorList.open]);

  const [sharing, setSharing] = useState(false);
  // 보내기 시트는 처음 열 때 만든다. 피드의 카드마다 미리 두면 닫힌 시트의 대화 목록 구독이 카드 수만큼
  // 쌓인다. 한 번 연 뒤에는 남겨 닫히는 애니메이션을 지킨다.
  const [shareMounted, setShareMounted] = useState(false);

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
          onClick={() => {
            setShareMounted(true);
            setSharing(true);
          }}
        >
          <SendIcon className="size-5" aria-hidden="true" />
        </button>
      </div>

      {reactions.summary.reaction_count > 0 ? (
        <button
          type="button"
          aria-label={`반응 ${reactions.summary.reaction_count}개 보기`}
          className="-mr-1 flex items-center gap-0.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted"
          onClick={reactorList.show}
        >
          {reactions.summary.top_reactions.map((item) => (
            <ReactionEmoji key={item} reaction={item} />
          ))}
        </button>
      ) : null}

      {shareMounted ? (
        <SharePostDialog
          open={sharing}
          onOpenChange={setSharing}
          path={sharePath}
          title={shareTitle}
        />
      ) : null}
      <ReactionListDialog
        open={reactorList.open}
        onOpenChange={(open) => {
          if (!open) reactorList.close();
        }}
        reactors={reactions.reactors}
        loading={reactions.loadingReactors}
      />
    </div>
  );
}
