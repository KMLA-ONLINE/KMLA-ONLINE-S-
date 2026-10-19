import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import type { MentionDisplayRange } from "~/features/posts/model/mentions";
import { cn } from "~/shared/lib/utils";

/**
 * `textarea`가 들고 있는 멘션을 색으로 보이게 하는 뒤판. `textarea`는 글자 일부만 달리 그릴 수 없어, 같은 글자를 같은
 * 자리에 그리는 판을 뒤에 깔고 `textarea`의 글자는 투명하게 둔다(`MENTION_HIGHLIGHT_INPUT_CLASS`). 멘션이 없으면
 * 그리지 않고 `textarea`가 평소대로 그린다.
 *
 * 둘은 한 그리드 칸에 겹쳐 두고, `className`에는 `textarea`와 같은 글꼴·줄 높이·안쪽 여백·최대 높이를 준다. 굵기처럼
 * 글자 폭을 바꾸는 꾸밈은 줄바꿈이 어긋나므로 멘션에는 색만 입힌다.
 */
export function MentionHighlight({
  text,
  ranges,
  inputRef,
  className,
}: {
  text: string;
  /** `useMentionTextarea()`의 `mentionRanges`. */
  ranges: MentionDisplayRange[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const highlighted = ranges.length > 0;

  // `textarea`가 스크롤한 만큼 뒤판도 옮긴다.
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !highlighted) return;
    const sync = () => {
      if (backdrop.current) backdrop.current.scrollTop = input.scrollTop;
    };
    input.addEventListener("scroll", sync);
    return () => input.removeEventListener("scroll", sync);
  }, [inputRef, highlighted]);
  // 값이 바뀌어 늘거나 준 줄은 스크롤 이벤트 없이 `scrollTop`을 바꿀 수 있다.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && backdrop.current) backdrop.current.scrollTop = input.scrollTop;
  });

  if (!highlighted) return null;

  const parts: ReactNode[] = [];
  let last = 0;
  for (const range of ranges) {
    parts.push(
      text.slice(last, range.start),
      <span key={range.start} className="text-primary">
        {text.slice(range.start, range.end)}
      </span>,
    );
    last = range.end;
  }
  parts.push(text.slice(last));

  return (
    <div
      ref={backdrop}
      aria-hidden
      className={cn(
        "pointer-events-none col-start-1 row-start-1 overflow-hidden wrap-break-word whitespace-pre-wrap text-foreground",
        className,
      )}
    >
      {parts}
      {/* 끝의 줄바꿈도 한 줄을 차지하게 한다. `textarea`는 빈 마지막 줄을 그린다. */}
      {"​"}
    </div>
  );
}

/**
 * 뒤판을 깐 `textarea`에 줄 클래스. 글자는 뒤판이 그리므로 투명하게 하고 캐럿만 남긴다. 스크롤바는 폭을 차지해 뒤판과 줄바꿈이
 * 어긋나므로 숨긴다.
 */
export const MENTION_HIGHLIGHT_INPUT_CLASS =
  "text-transparent caret-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
