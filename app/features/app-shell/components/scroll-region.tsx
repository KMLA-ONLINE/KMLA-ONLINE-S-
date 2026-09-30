import { useRef, type ReactNode, type RefObject } from "react";

import { ScrollContainerContext } from "~/shared/lib/scroll-container";
import { cn } from "~/shared/lib/utils";

/**
 * 레이아웃이 렌더하는 스크롤 영역. 셸 안에서 실제로 스크롤하는 유일한 엘리먼트다.
 *
 * 모바일 기본값은 좌우 여백 0이다. 여백이 필요한 페이지가 자기 콘텐츠에 `px-4`를 붙인다 —
 * 셸이 여백을 축 하나로 관리하지 않는다.
 */
export function ScrollRegion({
  className,
  children,
  scrollRef,
}: {
  className?: string;
  children: ReactNode;
  scrollRef?: RefObject<HTMLElement | null>;
}) {
  const internalRef = useRef<HTMLElement>(null);
  const ref = scrollRef ?? internalRef;

  return (
    <ScrollContainerContext value={ref}>
      <main
        ref={ref}
        // overscroll-contain: 끝에서 더 당길 때 브라우저 제스처로 전파되지 않게 한다(특히 iOS).
        // overflow-x-hidden 명시 필수: 세로만 지정하면 가로 `visible`이 `auto`로 계산돼 1px만 삐져나가도 페이지가 옆으로 끌린다.
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain md:[scrollbar-gutter:stable_both-edges]",
          className,
        )}
      >
        {children}
      </main>
    </ScrollContainerContext>
  );
}
