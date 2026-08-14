import { MessageCircleIcon, SendIcon, ThumbsUpIcon } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import { cn } from "~/shared/lib/utils";

const ACTION_CLASS =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

/**
 * 게시물 하단 액션 바.
 *
 * 반응은 아직 구현 전이라 자리만 잡고 비활성으로 둔다(기능 명세 §8.15). 붙일 때 레이아웃이
 * 흔들리지 않게 지금부터 같은 자리를 차지하게 하고, `disabled` 하나로는 이유가 전달되지 않아서
 * 레이블에 "준비 중"을 적는다.
 *
 * 댓글은 목록에서는 상세로 보내고(`commentTo`), 상세에서는 입력창으로 보낸다(`onComment`).
 */
export function GroupPostActionBar({
  sharePath,
  shareTitle,
  commentCount,
  commentTo,
  onComment,
  className,
}: {
  /** 게시물 상세의 앱 내부 경로. 절대 URL은 공유하는 순간에 만든다 — `window`를 render 중에 읽으면 build-time render가 깨진다. */
  sharePath: string;
  shareTitle: string;
  commentCount: number;
  commentTo?: string;
  onComment?: () => void;
  className?: string;
}) {
  const share = async () => {
    try {
      const url = new URL(sharePath, window.location.origin).toString();
      if (navigator.share) {
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

  const commentLabel = `댓글 ${commentCount}개`;
  // 0은 숫자로 적지 않는다. 아직 아무도 남기지 않은 자리에 0이 붙으면 눈에 걸린다.
  const commentInner = (
    <>
      <MessageCircleIcon className="size-4.5" aria-hidden="true" />
      {commentCount > 0 ? commentCount : null}
    </>
  );

  return (
    <div
      className={cn("flex items-center justify-between px-2 py-1", className)}
    >
      <div className="flex items-center text-muted-foreground">
        <button
          type="button"
          disabled
          aria-label="반응 (준비 중)"
          className={ACTION_CLASS}
        >
          <ThumbsUpIcon className="size-4.5" aria-hidden="true" />
        </button>
        {commentTo ? (
          <Link
            to={commentTo}
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
          <SendIcon className="size-4.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
