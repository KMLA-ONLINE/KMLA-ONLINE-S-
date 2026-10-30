import {
  isPostOverlayNavigation,
  postOverlayParent,
} from "~/features/app-shell/model/navigation";

export interface ScrollLocation {
  key: string;
  pathname: string;
}

/**
 * 경로별 스크롤 기억의 키. 목록 위 게시물 상세는 목록과 같은 스크롤 영역을 쓰므로 목록의 경로로
 * 기억한다 — 탭이 게시물 상세 경로를 기억했다가 돌아올 때 그 아래 목록 위치를 되살리기 위해서다.
 */
export function scrollMemoryPath(pathname: string): string {
  return postOverlayParent(pathname) ?? pathname;
}

/**
 * 화면이 바뀐 뒤 스크롤 영역을 어디에 둘지 정한다. `null`이면 건드리지 않는다.
 *
 * - 같은 경로 안의 이동(검색 파라미터, 이미지 뷰어·댓글 시트)과 목록 위 게시물 상세의 여닫기는 같은
 *   화면이라 그대로 둔다.
 * - 뒤로·앞으로 가기는 그 기록 항목에서 보던 위치로 돌아간다.
 * - `rememberByPath`인 화면(피드, 그룹)은 탭이나 링크로 다시 들어와도 마지막 위치로 돌아간다.
 * - 그 밖의 새 화면은 맨 위에서 시작한다. 공유 스크롤 영역이라 두지 않으면 이전 화면의 위치를 이어받는다.
 * - `previous`가 없는 첫 mount는 건드리지 않는다. 다만 메신저처럼 스크롤을 직접 소유하는 화면에서
 *   돌아오면 영역이 다시 mount되므로, 기억한 위치가 있으면 그리로 돌아간다.
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

  const fresh = previous ? 0 : null;
  const remembered = rememberByPath
    ? byPath.get(scrollMemoryPath(next.pathname))
    : undefined;
  if (navigationType === "POP")
    return byKey.get(next.key) ?? remembered ?? fresh;
  return remembered ?? fresh;
}
