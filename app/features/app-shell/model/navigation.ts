const POST_OVERLAY_PATTERN =
  /^(\/groups\/[^/]+|\/profile\/[^/]+)\/posts\/(?!new\/?$)[^/]+\/?$/;
const UI_OVERLAY_SEARCH_PARAMS = new Set(["image", "view"]);

function postOverlayParent(pathname: string): string | null {
  return POST_OVERLAY_PATTERN.exec(pathname)?.[1] ?? null;
}

/** 목록 위에 뜨는 게시물 상세 route를 열고 닫는 navigation인지 판정한다. */
export function isPostOverlayNavigation(
  currentPathname: string,
  nextPathname: string,
): boolean {
  const currentParent = postOverlayParent(currentPathname);
  const nextParent = postOverlayParent(nextPathname);

  return currentParent === nextPathname || nextParent === currentPathname;
}

/**
 * URL에 남기는 이미지 뷰어와 댓글 시트는 같은 화면 위의 UI일 뿐이다. 이 이동이 loading으로
 * 보이더라도 현재 Outlet을 skeleton으로 바꾸면 상세 dialog와 그 안의 로컬 상태가 사라진다.
 */
export function isSamePathUiOverlayNavigation(
  currentPathname: string,
  currentSearch: string,
  nextPathname: string,
  nextSearch: string,
): boolean {
  if (currentPathname !== nextPathname || currentSearch === nextSearch) {
    return false;
  }

  const current = new URLSearchParams(currentSearch);
  const next = new URLSearchParams(nextSearch);
  const keys = new Set([...current.keys(), ...next.keys()]);

  return Array.from(keys).every(
    (key) =>
      UI_OVERLAY_SEARCH_PARAMS.has(key) ||
      current.getAll(key).join("\0") === next.getAll(key).join("\0"),
  );
}
