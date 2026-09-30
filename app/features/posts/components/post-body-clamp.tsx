import { useCallback, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { useScrollContainer } from "~/shared/lib/scroll-container";
import { cn } from "~/shared/lib/utils";

/** 접힌 본문 최대 높이(24px × 3줄, `.post-typography` 줄 높이에 묶임). 본문이 여러 블록이라 `line-clamp`를 쓰지 않는다. */
const COLLAPSED_BODY_CLASS = "max-h-[72px] overflow-hidden";

/** 접을 때 카드 머리가 화면 위로 벗어나 있으면 머리가 보이는 자리로 되돌린다. 모바일 sticky 헤더 높이는 그때 잰다. */
function revealCardHead(body: HTMLElement, container: HTMLElement) {
  const card = body.closest("article") ?? body;
  const stickyHeader = container.querySelector<HTMLElement>("header.sticky");
  const visibleTop =
    container.getBoundingClientRect().top + (stickyHeader?.offsetHeight ?? 0);
  const overshoot = card.getBoundingClientRect().top - visibleTop;
  if (overshoot < 0) container.scrollTop += overshoot;
}

/** 피드 카드의 본문 접기. 실제로 잘렸을 때만 "더 보기"를 그린다. */
export function PostBodyClamp({
  testId,
  children,
}: {
  testId?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useScrollContainer();

  const measureBody = useCallback((node: HTMLDivElement | null) => {
    bodyRef.current = node;
    if (!node) return;
    setClampable(node.scrollHeight > node.clientHeight);
  }, []);

  const toggle = () => {
    if (!expanded) {
      setExpanded(true);
      return;
    }
    // 접힌 레이아웃을 먼저 그려야 카드가 어디로 밀려났는지 잴 수 있다. 같은 프레임에서
    // 스크롤까지 맞춰 화면이 한 번만 바뀐다.
    flushSync(() => setExpanded(false));
    const body = bodyRef.current;
    const container = scrollRef?.current;
    if (body && container) revealCardHead(body, container);
  };

  return (
    <>
      {/* 탭으로 펼치기는 포인터 전용 편의다. 키보드·낭독기는 아래 "더 보기" 버튼을 쓴다. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        data-testid={testId}
        ref={measureBody}
        onClick={(event) => {
          if (!window.matchMedia("(pointer: coarse)").matches) return;
          if ((event.target as Element).closest("a, button")) return;
          if (clampable || expanded) toggle();
        }}
        className={cn(
          !expanded && COLLAPSED_BODY_CLASS,
          // 터치 기기에서는 본문을 탭해도 펼쳐진다. 마우스에서는 버튼만 반응한다 —
          // 본문의 텍스트를 드래그해 선택하는 동작과 부딪히기 때문이다.
          (clampable || expanded) && "pointer-coarse:cursor-pointer",
        )}
      >
        {children}
      </div>
      {clampable || expanded ? (
        <button
          type="button"
          onClick={toggle}
          className="mt-0.5 text-sm font-medium text-muted-foreground hover:underline pointer-fine:font-semibold pointer-fine:text-foreground"
        >
          {expanded ? "접기" : "더 보기"}
        </button>
      ) : null}
    </>
  );
}
