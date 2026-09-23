import { useCallback, useEffect, useRef, useState } from "react";

import { useScrollContainer } from "~/shared/lib/scroll-container";

/** 바닥에 닿기 전에 미리 부르는 여유. 스크롤이 끊기지 않을 만큼만 둔다. */
const ROOT_MARGIN = "200px";

interface Options {
  /** 끄면 관찰하지 않는다. 다음 페이지가 없을 때 `false`로 둔다. */
  enabled: boolean;
  /** 페이지를 요청 중이면 `true`. 응답이 오면 다시 관찰을 건다. */
  pending?: boolean;
}

/**
 * 리스트 맨 아래 sentinel이 보이면 `onLoadMore`를 부른다.
 *
 * 반환한 콜백 ref를 sentinel 엘리먼트에 단다. 콜백 ref라 탭 전환처럼 노드가 나중에 붙거나
 * 사라져도 관찰을 다시 건다.
 *
 * 관찰 기준(root)은 뷰포트가 아니라 셸의 스크롤 영역이다. 뷰포트로 둬도 동작은 한다 —
 * IntersectionObserver가 조상의 clip을 반영하므로 `<main>` 밖으로 나간 sentinel은 어차피
 * 교차하지 않는다. 다만 `rootMargin`은 root 사각형을 기준으로 재기 때문에, 뷰포트를 root로
 * 두면 여유 200px 중 헤더·탭바 높이만큼이 이미 잡아먹힌 상태가 된다. 실제 스크롤 상자를
 * 지정하면 200px이 200px로 동작한다. 컨텍스트가 없는 곳(셸 밖)에서는 뷰포트로 떨어진다.
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  { enabled, pending = false }: Options,
): (element: HTMLElement | null) => void {
  const scrollRef = useScrollContainer();
  const onLoadMoreRef = useRef(onLoadMore);
  const triggeredRef = useRef(false);

  // 최신 콜백을 ref에 담아 둔다 — observer를 매 렌더 재생성하지 않으려고.
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  });

  const [node, setNode] = useState<HTMLElement | null>(null);
  const sentinelRef = useCallback((element: HTMLElement | null) => {
    setNode(element);
  }, []);

  useEffect(() => {
    if (!enabled || pending || !node) return;

    triggeredRef.current = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          triggeredRef.current = false;
          return;
        }

        // pending이 렌더에 반영되기 전에 observer가 다시 불려도 요청은 한 번만 시작한다.
        if (triggeredRef.current) return;
        triggeredRef.current = true;
        onLoadMoreRef.current();
      },
      // 의존성 배열이 지켜보는 건 ref 객체이지 `.current`가 아니다. 그래도 되는 이유는
      // React가 커밋 단계에서 ref를 먼저 붙이고 passive effect를 나중에 돌리기 때문이다 —
      // 이 이펙트가 도는 시점에 `<main>`은 이미 ref에 들어와 있다. 스크롤 영역이 나중에
      // 교체되는 구조가 생기면 이 가정이 깨지므로 그때는 `.current`를 state로 올려야 한다.
      { root: scrollRef?.current ?? null, rootMargin: ROOT_MARGIN },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node, pending, scrollRef]);

  return sentinelRef;
}
