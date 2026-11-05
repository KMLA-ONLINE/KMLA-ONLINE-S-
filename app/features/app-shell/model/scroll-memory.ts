import {
  isPostOverlayNavigation,
  postOverlayParent,
} from "~/features/app-shell/model/navigation";

export interface ScrollLocation {
  key: string;
  pathname: string;
}

/**
 * 경로별 위치를 저장하는 키. 목록 위 게시물 상세가 열려 있어도 스크롤하는 건 뒤의 목록이므로 목록
 * 경로로 저장하고 읽는다. 상세를 열어 둔 채 탭을 떠났다 돌아와도 목록 위치가 맞는다.
 */
export function scrollPathKey(pathname: string): string {
  return postOverlayParent(pathname) ?? pathname;
}

/**
 * 화면이 바뀐 뒤 스크롤 영역을 어디에 둘지 정한다. `null`이면 건드리지 않는다.
 *
 * - 같은 경로 안의 이동(검색 파라미터, 이미지 뷰어·댓글 시트)과 목록 위 게시물 상세의 여닫기는 같은
 *   화면이라 그대로 둔다.
 * - 뒤로·앞으로 가기는 그 기록 항목에서 보던 위치로 돌아간다.
 * - `rememberByPath`인 화면(피드, 탭을 바꿔 돌아온 화면)은 마지막 위치로 돌아간다.
 * - 그 밖의 새 화면은 맨 위에서 시작한다. 공유 스크롤 영역이라 두지 않으면 이전 화면의 위치를 이어받는다.
 * - `previous`가 없으면 스크롤 영역이 막 마운트된 것이다(앱 첫 화면, 또는 메신저처럼 스크롤 영역을
 *   쓰지 않는 화면에서 돌아옴). 새 엘리먼트라 이미 맨 위이므로 기억한 위치가 있을 때만 옮긴다.
 */
export function resolveScrollTarget({
  previous,
  next,
  navigationType,
  rememberByPath,
  byKey,
  byPath,
}: {
  previous: ScrollLocation | null;
  next: ScrollLocation;
  navigationType: "POP" | "PUSH" | "REPLACE";
  rememberByPath: boolean;
  byKey: ReadonlyMap<string, number>;
  byPath: ReadonlyMap<string, number>;
}): number | null {
  if (previous) {
    if (previous.key === next.key) return null;
    if (previous.pathname === next.pathname) return null;
    if (isPostOverlayNavigation(previous.pathname, next.pathname)) return null;
  }

  const remembered = rememberByPath
    ? byPath.get(scrollPathKey(next.pathname))
    : undefined;
  const target =
    navigationType === "POP" ? (byKey.get(next.key) ?? remembered) : remembered;
  return target ?? (previous ? 0 : null);
}
