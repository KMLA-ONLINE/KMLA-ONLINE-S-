import { useLayoutEffect, type RefObject } from "react";

interface Options {
  /** 끄면 폭을 건드리지 않고, 줄여 둔 폭도 되돌린다. */
  enabled: boolean;
  /** 줄이 바뀔 수 있는 내용이 바뀌면 다시 잰다. 본문처럼 원시값을 넘긴다. */
  contentKey: string;
  /** 상자 안의 다른 내용이 바라는 최소 내용 폭(rem). 상자가 그보다 좁으면 상자 폭을 따른다. */
  minContentRem?: number;
}

/**
 * 여러 줄로 감긴 글 상자의 폭을 가장 긴 줄에 맞춘다. 브라우저는 줄이 바뀌면 상자를 쓸 수 있는 폭
 * 끝까지 넓히므로, 다음 줄로 넘어간 단어만큼 오른쪽에 빈 공간이 남는다. CSS로는 줄인 폭을 얻을 수
 * 없어서 그린 뒤 줄 상자를 재서 폭을 정한다. 한 줄이면 이미 내용에 맞으므로 손대지 않는다.
 *
 * `boxRef`는 폭을 바꿀 상자, `textRef`는 그 안에서 줄을 잴 inline 요소다. 쓸 수 있는 폭이 바뀌면
 * (화면이나 옆 패널 크기) 가장 가까운 `article`의 크기 변화를 보고 다시 잰다. `article`은 그대로인데
 * 옆 요소가 생겨 상자 자리만 좁아지면 상자의 `max-width`가 상자를 줄이므로, 상자 크기 변화도 보고
 * 줄어든 폭에서 다시 잰다. 상자는 `max-width: 100%`여야 한다.
 */
export function useShrinkWrap(
  boxRef: RefObject<HTMLElement | null>,
  textRef: RefObject<HTMLElement | null>,
  { enabled, contentKey, minContentRem = 0 }: Options,
) {
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!enabled || !box || !text) return;

    let cancelled = false;
    function fit() {
      if (cancelled || !box || !text) return;
      box.style.width = "";
      const lines = text.getClientRects();
      if (lines.length < 2) return;

      const style = getComputedStyle(box);
      const boxRect = box.getBoundingClientRect();
      const contentLeft =
        boxRect.left +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.paddingLeft);
      let lineRight = contentLeft;
      for (const line of lines) lineRight = Math.max(lineRight, line.right);
      const minContent =
        minContentRem *
        parseFloat(getComputedStyle(document.documentElement).fontSize);
      const contentWidth = Math.max(lineRight - contentLeft, minContent);
      // 소수점 폭을 내림하면 마지막 단어가 다시 다음 줄로 넘어가므로 올림한다.
      const width = Math.ceil(
        contentWidth +
          (contentLeft - boxRect.left) +
          parseFloat(style.paddingRight) +
          parseFloat(style.borderRightWidth),
      );
      if (width < boxRect.width - 1) box.style.width = `${width}px`;
    }

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box.closest("article") ?? document.documentElement);
    observer.observe(box);
    // 웹 글꼴이 늦게 오면 글자 폭이 바뀐다. jsdom에는 `document.fonts`가 없다.
    if ("fonts" in document) void document.fonts.ready.then(fit);

    return () => {
      cancelled = true;
      observer.disconnect();
      box.style.width = "";
    };
  }, [boxRef, textRef, enabled, contentKey, minContentRem]);
}
