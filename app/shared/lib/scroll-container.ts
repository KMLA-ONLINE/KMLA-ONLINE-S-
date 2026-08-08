import { createContext, use, type RefObject } from "react";

/**
 * 실제로 스크롤하는 엘리먼트.
 *
 * 셸이 `h-dvh`를 잡고 있어서 스크롤 주체는 `window`가 아니라 레이아웃의 `<main>`이다.
 * 스크롤에 붙어야 하는 것들(sticky 헤더 자동 숨김, 무한 스크롤, 맨 위로)이 전부 이 ref로 같은
 * 엘리먼트를 잡는다 — 훅마다 컨테이너를 다시 찾을 필요가 없다.
 *
 * 셸 도메인이 아니라 `shared/`에 있는 이유: 컨텍스트를 채우는 건 셸(`ScrollRegion`)이지만
 * 읽는 쪽은 어느 도메인의 페이지든 될 수 있다. `shared/`가 도메인을 import 하는 일이 없어야 한다.
 *
 * 컴포넌트(`ScrollRegion`)는 `~/features/app-shell`에 따로 있다. 한 파일에서 컴포넌트와 훅을 같이
 * export 하면 fast refresh가 그 모듈을 통째로 새로 만든다.
 */
export const ScrollContainerContext =
  createContext<RefObject<HTMLElement | null> | null>(null);

export function useScrollContainer(): RefObject<HTMLElement | null> | null {
  return use(ScrollContainerContext);
}
