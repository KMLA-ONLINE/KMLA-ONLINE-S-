import { useCallback, useState, type ReactNode } from "react";

import { cn } from "~/shared/lib/utils";

/**
 * 접힌 본문의 최대 높이. `line-clamp`를 쓰지 않는 이유는 본문이 여러 블록(문단, 제목)으로
 * 이루어져 있어서다 — `-webkit-line-clamp`는 한 덩어리의 인라인 흐름만 자르므로 문단이
 * 두 개면 첫 문단만 잘리고 나머지는 그대로 나온다.
 */
const COLLAPSED_BODY_CLASS = "max-h-[66px] overflow-hidden";

/**
 * 피드 카드의 본문 접기. 그룹 카드와 프로필 타임라인 카드가 함께 쓴다.
 *
 * 실제로 잘렸을 때만 "더 보기"를 그린다. 글자 수로 어림잡으면 폭이 넓은 화면에서 잘리지도
 * 않은 본문에 버튼이 붙는다.
 */
export function PostBodyClamp({
  testId,
  children,
}: {
  testId?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);

  const measureBody = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    setClampable(node.scrollHeight > node.clientHeight);
  }, []);

  return (
    <>
      {/* 터치에서 본문을 탭해 펼치는 것은 포인터 전용 편의다. 키보드와 낭독기는 바로 아래
          "더 보기" 버튼을 쓰므로 여기에 role을 얹지 않는다. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        data-testid={testId}
        ref={measureBody}
        onClick={(event) => {
          if (!window.matchMedia("(pointer: coarse)").matches) return;
          if ((event.target as Element).closest("a, button")) return;
          if (clampable || expanded) setExpanded((current) => !current);
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
          onClick={() => setExpanded((current) => !current)}
          className="mt-0.5 text-sm font-medium text-muted-foreground hover:underline pointer-fine:font-semibold pointer-fine:text-foreground"
        >
          {expanded ? "접기" : "더 보기"}
        </button>
      ) : null}
    </>
  );
}
