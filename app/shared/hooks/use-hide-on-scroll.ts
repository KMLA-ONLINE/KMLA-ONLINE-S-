import { useEffect, useState, type RefObject } from "react";

import { useScrollContainer } from "~/shared/lib/scroll-container";

interface Options {
  /** 끄면 항상 `false`를 준다. 라우트가 조건부로 켤 때 쓴다. */
  enabled?: boolean;
  /** 이 위치보다 위에서는 절대 숨기지 않는다. 맨 위 근처에서 깜빡이는 걸 막는다. */
  threshold?: number;
  /** 방향을 인정하기 위한 최소 이동량(px). 트랙패드 미세 스크롤로 토글되는 걸 막는다. */
  tolerance?: number;
  /** 셸처럼 컨텍스트 바깥에서 스크롤 영역을 소유할 때 직접 전달한다. */
  containerRef?: RefObject<HTMLElement | null>;
}

/**
 * 아래로 읽으면 `true`, 위로 올리면 `false`.
 *
 * 숨길 대상(`PageHeader`)이 직접 부른다. 셸이 스크롤 상태를 들고 있다가 플래그로 내려보내지
 * 않는다.
 *
 * 모바일 전용 여부는 이 훅이 판단하지 않는다. 사용하는 쪽이 `max-md:` 클래스로만 효과를 주면
 * JS 미디어 쿼리 없이 끝난다.
 */
export function useHideOnScroll({
  enabled = true,
  threshold = 64,
  tolerance = 8,
  containerRef,
}: Options = {}) {
  const contextRef = useScrollContainer();
  const resolvedRef = containerRef ?? contextRef;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const element = resolvedRef?.current;
    if (!enabled || !element) {
      setHidden(false);
      return;
    }

    let lastTop = element.scrollTop;
    let frameId = 0;

    const update = () => {
      frameId = 0;
      const top = element.scrollTop;
      const delta = top - lastTop;

      if (Math.abs(delta) < tolerance) return;
      lastTop = top;
      setHidden(delta > 0 && top > threshold);
    };

    const onScroll = () => {
      if (frameId === 0) frameId = window.requestAnimationFrame(update);
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
    };
  }, [resolvedRef, enabled, threshold, tolerance]);

  return hidden;
}
