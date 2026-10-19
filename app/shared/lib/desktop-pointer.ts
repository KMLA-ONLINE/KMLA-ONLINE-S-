/** `app.css`의 `overscroll-x-desktop-auto`와 같은 기준이다. */
const DESKTOP_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/**
 * 마우스나 트랙패드가 주 입력인 컴퓨터인가. 갤럭시 탭처럼 데스크톱 사이트를 요청하는 태블릿은 UA에
 * `Android`가 없어서 UA로는 컴퓨터와 갈라낼 수 없다. 주 입력이 터치면 아니다. `window`를 읽으므로
 * effect, 이벤트 핸들러나 브라우저에서만 도는 초기값에서 부른다.
 */
export function hasDesktopPointer(): boolean {
  return window.matchMedia(DESKTOP_POINTER_QUERY).matches;
}
