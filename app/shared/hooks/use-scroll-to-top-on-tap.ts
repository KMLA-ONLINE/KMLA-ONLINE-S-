import type { MouseEvent } from "react";

import { scrollToTop, useScrollContainer } from "~/shared/lib/scroll-container";

/**
 * 헤더 안에서 제 동작이 따로 있는 것. 이것들을 누르면 맨 위로 가지 않는다. 목록에 없는 모양의
 * 컨트롤을 헤더에 넣으면 `data-no-scroll-top`을 붙인다.
 */
const INTERACTIVE = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[contenteditable]",
  "[tabindex]",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='menuitem']",
  "[role='option']",
  "[data-no-scroll-top]",
].join(", ");

/**
 * 모바일 헤더의 빈 곳이나 제목을 누르면 스크롤 영역을 맨 위로 올리는 클릭 핸들러.
 *
 * 다시 불러오지 않는다 — 위치만 바꾼다. 헤더 안의 버튼·링크는 각자의 동작을 그대로 한다.
 */
export function useScrollToTopOnTap() {
  const container = useScrollContainer();

  return (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    // React 이벤트는 portal을 넘어 컴포넌트 트리를 따라 올라온다. 헤더 버튼이 연 메뉴·다이얼로그는
    // DOM으로는 헤더 밖이지만 그 안의 클릭이 여기 닿으므로, 실제로 헤더 안을 누른 것만 받는다.
    if (!(target instanceof Element) || !event.currentTarget.contains(target))
      return;
    if (target.closest(INTERACTIVE)) return;
    scrollToTop(container?.current);
  };
}
