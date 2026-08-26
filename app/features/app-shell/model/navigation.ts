const POST_OVERLAY_PATTERN =
  /^(\/groups\/[^/]+|\/profile\/[^/]+)\/posts\/(?!new\/?$)[^/]+\/?$/;

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
